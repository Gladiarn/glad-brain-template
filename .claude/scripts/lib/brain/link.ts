/**
 * `brain link`: wire a code repo to a vault project.
 *
 * It records one entry in the vault's `projects.map.json`, creates the
 * project's `next.md` and `tasks.md` from the templates, and adds a line to
 * `work/Index.md`. Nothing is written into the code repo by this module; the
 * only thing that touches the repo is the code-only graphify build (its output
 * hidden from git through the local-only `.git/info/exclude`), which
 * the caller can see in the result.
 */

import { spawnSync } from "node:child_process";
import { appendFileSync, existsSync, mkdirSync, readFileSync, realpathSync, statSync, writeFileSync } from "node:fs";
import { basename, dirname, isAbsolute, join, resolve, sep } from "node:path";
import { writeFileAtomic } from "../atomic-write.ts";
import { graphifyEnv } from "./graph.ts";
import { isValidProjectName, MAP_FILE, repoKeys, type MapEntry } from "./project.ts";

export class LinkError extends Error {}

export type LinkOptions = {
	vaultRoot: string;
	repo: string;
	project?: string | undefined;
	client?: string | undefined;
	now?: Date;
};

export type LinkResult = {
	project: string;
	client: string | null;
	key: string;
	created: string[];
	indexLine: "added" | "present";
	graphify: string;
};

const GRAPHIFY_TIMEOUT_MS = 10 * 60_000;

export function kebabCase(name: string): string {
	return name
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/^-+|-+$/g, "");
}

export function quarterOf(d: Date): string {
	return `Q${Math.floor(d.getMonth() / 3) + 1}-${d.getFullYear()}`;
}

export function isoDate(d: Date): string {
	const pad = (n: number) => String(n).padStart(2, "0");
	return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function fillTemplate(text: string, vars: Record<string, string>): string {
	return text.replace(/\{\{(\w+)\}\}/g, (m, k: string) => vars[k] ?? m);
}

function readMapStrict(path: string): { projects: Record<string, MapEntry> } {
	if (!existsSync(path)) return { projects: {} };
	let raw: unknown;
	try {
		raw = JSON.parse(readFileSync(path, "utf8"));
	} catch {
		throw new LinkError(`${MAP_FILE} is not valid JSON; fix it by hand, I will not overwrite it`);
	}
	const projects = (raw as { projects?: unknown } | null)?.projects;
	if (typeof projects !== "object" || projects === null || Array.isArray(projects)) {
		throw new LinkError(`${MAP_FILE} has no "projects" object; fix it by hand, I will not overwrite it`);
	}
	return { projects: projects as Record<string, MapEntry> };
}

/** Insert `line` under `## Active Projects`, replacing an empty placeholder bullet if there is one. */
export function addIndexLine(text: string, line: string): string {
	const lines = text.split("\n");
	const head = lines.findIndex((l) => /^##\s+Active Projects\s*$/.test(l));
	if (head === -1) {
		const base = text.endsWith("\n") || text === "" ? text : `${text}\n`;
		return `${base}\n## Active Projects\n\n${line}\n`;
	}
	let end = lines.findIndex((l, i) => i > head && /^##\s/.test(l));
	if (end === -1) end = lines.length;
	let placeholder = -1;
	let lastBullet = -1;
	for (let i = head + 1; i < end; i++) {
		if (/^-\s*$/.test(lines[i]!) && placeholder === -1) placeholder = i;
		if (/^-\s/.test(lines[i]!)) lastBullet = i;
	}
	if (placeholder !== -1) {
		lines[placeholder] = line;
	} else if (lastBullet !== -1) {
		lines.splice(lastBullet + 1, 0, line);
	} else {
		let at = end;
		while (at > head + 1 && lines[at - 1]!.trim() === "") at--;
		lines.splice(at, 0, "", line);
	}
	return lines.join("\n");
}

/**
 * Keep graphify's output out of the repo's git status without touching any
 * tracked file: `.git/info/exclude` is local to this clone and never shared,
 * so a client repo shows no trace of the brain.
 */
function excludeGraphifyOut(repo: string): void {
	const r = spawnSync("git", ["-C", repo, "rev-parse", "--git-path", "info/exclude"], { encoding: "utf8", timeout: 5_000, windowsHide: true });
	if (r.status !== 0) return;
	const rel = r.stdout.trim();
	if (rel === "") return;
	const file = isAbsolute(rel) ? rel : join(repo, rel);
	try {
		const current = existsSync(file) ? readFileSync(file, "utf8") : "";
		if (current.split("\n").includes("graphify-out/")) return;
		mkdirSync(dirname(file), { recursive: true });
		appendFileSync(file, `${current === "" || current.endsWith("\n") ? "" : "\n"}graphify-out/\n`);
	} catch {
		/* best effort: the link itself is done */
	}
}

function runGraphify(repo: string): string {
	excludeGraphifyOut(repo);
	const r = spawnSync("graphify", ["update", repo], {
		cwd: repo,
		// Code-only: no backend, so graphify cannot reach any model.
		env: graphifyEnv(process.env, "none"),
		encoding: "utf8",
		timeout: GRAPHIFY_TIMEOUT_MS,
		windowsHide: true,
	});
	const code = (r.error as NodeJS.ErrnoException | undefined)?.code;
	if (code === "ENOENT") return "graphify is not installed; skipped the code graph (run setup.sh, then `graphify update <repo>`)";
	if (r.error) return `graphify did not finish (${r.error.message}); the link itself is done`;
	if (r.status !== 0) return `graphify update exited ${r.status}; the link itself is done`;
	return "graphify update done (code-only, no LLM)";
}

export function linkRepo(opts: LinkOptions): LinkResult {
	const now = opts.now ?? new Date();
	const vault = realpathSync(opts.vaultRoot);

	const repoInput = resolve(opts.repo);
	if (!existsSync(repoInput) || !statSync(repoInput).isDirectory()) {
		throw new LinkError(`repo folder not found: ${repoInput}`);
	}
	const repo = realpathSync(repoInput);
	if (repo === vault || repo.startsWith(vault + sep)) {
		throw new LinkError("that folder is inside the vault; sessions there already use the general project");
	}

	const keys = repoKeys(repo);
	const key = keys.remote ?? keys.path;

	const mapPath = join(vault, MAP_FILE);
	const map = readMapStrict(mapPath);
	const existing = map.projects[key];

	const project = opts.project ?? existing?.project ?? kebabCase(basename(repo));
	if (!isValidProjectName(project)) {
		throw new LinkError(`project name "${project}" is not usable: use letters, digits, dot, dash or underscore, and pass --project`);
	}
	const client = opts.client ?? existing?.client ?? null;

	const templates = join(vault, "templates");
	const nextTpl = join(templates, "Project Next.md");
	const tasksTpl = join(templates, "Project Tasks.md");
	if (!existsSync(nextTpl) || !existsSync(tasksTpl)) {
		throw new LinkError("the Project Next and Project Tasks templates are missing from templates/");
	}

	const vars = { date: isoDate(now), quarter: quarterOf(now), title: project, project };
	const dir = join(vault, "work", "active", project);
	mkdirSync(dir, { recursive: true });
	const created: string[] = [];
	for (const [file, tpl] of [
		["next.md", nextTpl],
		["tasks.md", tasksTpl],
	] as const) {
		try {
			writeFileSync(join(dir, file), fillTemplate(readFileSync(tpl, "utf8"), vars), { flag: "wx" });
			created.push(`work/active/${project}/${file}`);
		} catch (e) {
			if ((e as NodeJS.ErrnoException).code !== "EEXIST") throw e;
		}
	}

	map.projects[key] = { project, client };
	writeFileAtomic(mapPath, `${JSON.stringify(map, null, "\t")}\n`);

	const indexPath = join(vault, "work", "Index.md");
	const indexText = existsSync(indexPath) ? readFileSync(indexPath, "utf8") : "# Work Notes\n";
	let indexLine: LinkResult["indexLine"] = "present";
	if (!indexText.includes(`[[work/active/${project}/next|`)) {
		const line = `- [[work/active/${project}/next|${project}]] — ${client === null ? "linked code repo" : `${client} project`}`;
		writeFileAtomic(indexPath, addIndexLine(indexText, line));
		indexLine = "added";
	}

	return { project, client, key, created, indexLine, graphify: runGraphify(repo) };
}
