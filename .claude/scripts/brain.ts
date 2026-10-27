#!/usr/bin/env node
/**
 * brain: the second-brain CLI. One dispatcher, one subcommand per job.
 *
 *   brain link [--project <name>] [--client <name>] [--repo <path>]
 *   brain save --summary <file>
 *   brain save --commit-only
 *   brain sync
 *   brain graph [--notes] [--yes]
 *   brain view
 *   brain scan-diff
 *   brain setup-merge settings|claude-md|config ...   (what setup.sh calls)
 *   brain status
 *
 * The vault is `BRAIN_VAULT` when set, else the folder this script lives in.
 */

import { copyFileSync, existsSync, mkdirSync, readFileSync, statSync, chmodSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { loadConfig } from "./lib/brain/config.ts";
import { graphCommand, viewGraph } from "./lib/brain/graph.ts";
import { mergeClaudeMd, mergeHooks, setQmdEnabled } from "./lib/brain/install.ts";
import { writeFileAtomic } from "./lib/atomic-write.ts";
import { LinkError, linkRepo } from "./lib/brain/link.ts";
import { resolveProject, type ResolvedProject } from "./lib/brain/project.ts";
import { runSave } from "./lib/brain/save/pipeline.ts";
import { scanDiff } from "./lib/brain/secrets.ts";
import { parseSummary } from "./lib/brain/save/schema.ts";
import { isInsideVault, sessionProjectDir } from "./lib/brain/session.ts";
import { headCommit, repoRoot } from "./lib/brain/code-graph.ts";
import { commitPush, pull, withSaveLock } from "./lib/brain/sync.ts";
import { markSaved } from "./lib/brain/unsaved.ts";
import { resolveVaultRoot } from "./lib/brain/vault.ts";
import { isMainModule } from "./lib/main-guard.ts";
import { loadStoredKey } from "./lib/brain/env-file.ts";

const USAGE = `usage:
  brain link [--project <name>] [--client <name>] [--repo <path>]
  brain save --summary <file>
  brain save --commit-only
  brain sync
  brain graph [--notes] [--yes]
  brain view
  brain scan-diff        (reads a unified diff on stdin; the pre-commit hook uses it)
  brain setup-merge settings --file <settings.json>
  brain setup-merge claude-md --file <CLAUDE.md>
  brain setup-merge config --qmd <true|false>
  brain status`;

type Flags = Record<string, string>;

function parseFlags(args: string[], allowed: readonly string[], booleans: readonly string[] = []): Flags {
	const flags: Flags = {};
	for (let i = 0; i < args.length; i++) {
		const arg = args[i]!;
		const m = /^--([a-z-]+)(?:=(.*))?$/.exec(arg);
		if (m && booleans.includes(m[1]!) && m[2] === undefined) {
			flags[m[1]!] = "true";
			continue;
		}
		if (!m || !allowed.includes(m[1]!)) throw new LinkError(`unknown option: ${arg}\n${USAGE}`);
		const value = m[2] ?? args[++i];
		if (value === undefined || value.startsWith("--")) throw new LinkError(`--${m[1]} needs a value`);
		flags[m[1]!] = value;
	}
	return flags;
}

function cmdLink(args: string[], vaultRoot: string): number {
	const flags = parseFlags(args, ["project", "client", "repo"]);
	const result = linkRepo({
		vaultRoot,
		repo: flags["repo"] ?? process.cwd(),
		project: flags["project"],
		client: flags["client"],
	});
	console.log(`linked: ${result.project}${result.client === null ? "" : ` (client: ${result.client})`}`);
	console.log(`map key: ${result.key}`);
	for (const f of result.created) console.log(`created: ${f}`);
	console.log(`work/Index.md: ${result.indexLine === "added" ? "line added" : "line already there"}`);
	console.log(result.graphify);
	return 0;
}

/** The project the save is for: the working folder's, else the folder the session started in. */
function projectForSave(vaultRoot: string): ResolvedProject | null {
	return (
		resolveProject(process.cwd(), vaultRoot) ??
		resolveProject(sessionProjectDir(process.env, process.cwd()), vaultRoot)
	);
}

/** The code repo's HEAD at a save, so the next session can tell how far the plan is behind; null in the vault. */
function saveCommit(vaultRoot: string): string | null {
	for (const dir of [process.cwd(), sessionProjectDir(process.env, process.cwd())]) {
		const root = repoRoot(dir);
		if (root !== null && !isInsideVault(root, vaultRoot) && resolveProject(dir, vaultRoot) !== null) return headCommit(root);
	}
	return null;
}

const BUSY_MESSAGE = "save busy: another session is saving this vault right now; say `save` again in a moment";

function lockWaitMs(): number {
	const n = Number(process.env["BRAIN_SAVE_WAIT_MS"]);
	return Number.isFinite(n) && n > 0 ? n : 30_000;
}

function requireProject(vaultRoot: string): ResolvedProject {
	const project = projectForSave(vaultRoot);
	if (project === null) {
		throw new LinkError("this folder is not linked to a vault project; run `brain link` in the repo first");
	}
	return project;
}

async function cmdSave(args: string[], vaultRoot: string): Promise<number> {
	const flags = parseFlags(args, ["summary"], ["commit-only"]);
	if (flags["commit-only"] !== undefined) {
		const project = requireProject(vaultRoot);
		const done = await withSaveLock(
			vaultRoot,
			async () => {
				const pushed = commitPush(vaultRoot, `brain: save ${project.name}`);
				markSaved(vaultRoot, project.name, new Date(), saveCommit(vaultRoot));
				return pushed;
			},
			{ waitMs: lockWaitMs() },
		);
		if (done === "busy") {
			console.log(BUSY_MESSAGE);
			return 4;
		}
		console.log(done.pushed ? "committed and pushed" : "committed");
		if (done.warning !== undefined) console.log(`warning: ${done.warning}`);
		return 0;
	}

	const file = flags["summary"];
	if (file === undefined) throw new LinkError(`save needs --summary <file>\n${USAGE}`);
	if (!existsSync(file)) throw new LinkError(`summary file not found: ${file}`);
	let raw: unknown;
	try {
		raw = JSON.parse(readFileSync(file, "utf8"));
	} catch {
		throw new LinkError("the summary file is not valid JSON");
	}
	const parsed = parseSummary(raw);
	if (!parsed.ok) throw new LinkError(`invalid summary: ${parsed.error}`);

	const project = requireProject(vaultRoot);
	if (parsed.summary.project !== project.name) {
		throw new LinkError(
			`the summary is for project "${parsed.summary.project}" but this folder is project "${project.name}"; nothing was saved`,
		);
	}

	const result = await withSaveLock(
		vaultRoot,
		() =>
			runSave({
				vaultRoot,
				summary: parsed.summary,
				hooks: { commitPush: (m) => commitPush(vaultRoot, m), markSaved: (p) => markSaved(vaultRoot, p, new Date(), saveCommit(vaultRoot)) },
			}),
		{ waitMs: lockWaitMs() },
	);
	if (result === "busy") {
		console.log(BUSY_MESSAGE);
		return 4;
	}
	if (result.outcome === "saved") {
		console.log(`saved via Gemini (${result.model ?? loadConfig(vaultRoot).geminiModel})`);
		console.log("files:");
		for (const f of result.files) console.log(`- ${f}`);
		if (result.reason !== undefined) console.log(`warning: ${result.reason}`);
		// The notes graph is off by default; with graphAfterSave it starts in the
		// background and only through Gemini. Whatever happens to it is a line
		// here, never a failed save.
		if (loadConfig(vaultRoot).graphAfterSave) {
			const graph = graphCommand({ vaultRoot, notes: true, yes: true, detached: true });
			console.log(`graph: ${graph.message}`);
		}
		return 0;
	}
	console.log(`fallback: ${result.reason ?? "Gemini could not save"}`);
	console.log("Nothing was written. Update exactly these files from the summary (a file that does not exist yet may be created):");
	for (const f of result.files) console.log(`- ${f}${existsSync(join(vaultRoot, f)) ? "" : " (new)"}`);
	return 3;
}

function cmdSync(vaultRoot: string): number {
	const pulled = pull(vaultRoot);
	if (!pulled.ok) console.log(`warning: ${pulled.warning}`);
	if (!pulled.ok && pulled.conflicts !== undefined) return 1;
	const pushed = commitPush(vaultRoot, "brain: sync");
	console.log(pushed.pushed ? "synced: pulled, then committed and pushed" : "synced locally");
	if (pushed.warning !== undefined) console.log(`warning: ${pushed.warning}`);
	return 0;
}

function cmdGraph(args: string[], vaultRoot: string): number {
	const flags = parseFlags(args, [], ["notes", "yes"]);
	const notes = flags["notes"] !== undefined;
	const yes = flags["yes"] !== undefined;
	if (yes && !notes) throw new LinkError("--yes only goes with --notes");
	const r = graphCommand({ vaultRoot, notes, yes, inherit: true });
	console.log(r.message);
	// Asking first is a normal outcome; a refusal or a failure is not.
	return r.ran || !notes || !yes ? 0 : 1;
}

function cmdView(vaultRoot: string): number {
	const r = viewGraph({ vaultRoot });
	console.log(r.message);
	return r.opened ? 0 : 1;
}

/** Scan a unified diff from stdin for secrets; report rule and place, never the value. */
function cmdScanDiff(): number {
	const hits = scanDiff(readFileSync(0, "utf8"));
	for (const h of hits) console.error(`secret guard: ${h.rule} at ${h.file}:${h.line}`);
	if (hits.length > 0) console.error("secret guard: commit blocked; remove the secret from the staged change (the value is not printed)");
	return hits.length > 0 ? 1 : 0;
}

const stamp = (d = new Date()) => d.toISOString().replace(/[-:]/g, "").replace(/\.\d+Z$/, "").replace("T", "-");

/** Write `text` to `file` atomically, after a timestamped backup of what was there. */
function writeWithBackup(file: string, text: string): string | null {
	mkdirSync(dirname(file), { recursive: true });
	let backup: string | null = null;
	let mode: number | null = null;
	if (existsSync(file)) {
		mode = statSync(file).mode & 0o777;
		backup = `${file}.bak-${stamp()}`;
		copyFileSync(file, backup);
	}
	writeFileAtomic(file, text);
	if (mode !== null) chmodSync(file, mode);
	return backup;
}

function cmdSetupMerge(args: string[], vaultRoot: string): number {
	const [what, ...rest] = args;
	const flags = parseFlags(rest, ["file", "qmd"]);
	const read = (f: string) => (existsSync(f) ? readFileSync(f, "utf8") : "");
	try {
		if (what === "settings") {
			const file = flags["file"];
			if (file === undefined) throw new LinkError("settings needs --file <settings.json>");
			const text = read(file);
			let current: unknown = {};
			if (text.trim() !== "") {
				try {
					current = JSON.parse(text);
				} catch {
					throw new LinkError(`${file} is not valid JSON; I did not touch it`);
				}
			}
			const merged = mergeHooks(current, vaultRoot);
			if (!merged.changed) {
				console.log(`${file}: brain hooks already in place`);
				return 0;
			}
			const backup = writeWithBackup(file, `${JSON.stringify(merged.settings, null, 2)}\n`);
			console.log(`${file}: brain hooks added${backup === null ? "" : ` (backup: ${backup})`}`);
			return 0;
		}
		if (what === "claude-md") {
			const file = flags["file"];
			if (file === undefined) throw new LinkError("claude-md needs --file <CLAUDE.md>");
			const merged = mergeClaudeMd(read(file), vaultRoot);
			if (!merged.changed) {
				console.log(`${file}: second-brain section already in place`);
				return 0;
			}
			const backup = writeWithBackup(file, merged.text);
			console.log(`${file}: second-brain section written${backup === null ? "" : ` (backup: ${backup})`}`);
			return 0;
		}
		if (what === "config") {
			const q = flags["qmd"];
			if (q !== "true" && q !== "false") throw new LinkError("config needs --qmd true|false");
			const file = resolve(vaultRoot, "brain.config.json");
			const next = setQmdEnabled(read(file), q === "true");
			if (next !== read(file)) writeFileAtomic(file, next);
			console.log(`brain.config.json: qmdEnabled ${q}`);
			return 0;
		}
	} catch (e) {
		if (e instanceof LinkError) throw e;
		throw new LinkError((e as Error).message);
	}
	throw new LinkError(`unknown setup-merge target\n${USAGE}`);
}

function cmdStatus(vaultRoot: string): number {
	const config = loadConfig(vaultRoot);
	const project = resolveProject(process.cwd(), vaultRoot);
	console.log(`vault: ${vaultRoot}`);
	if (project === null) {
		console.log("project: not linked (run `brain link` in this repo)");
	} else {
		console.log(`project: ${project.name} (via ${project.source})`);
		console.log(`client: ${project.client ?? "none"}`);
		console.log(`plan: ${project.dir}`);
	}
	console.log(`gemini model: ${config.geminiModel}`);
	console.log(`gemini key: ${(process.env["GEMINI_API_KEY"] ?? "") === "" ? "not set" : "set"}`);
	console.log(`qmd: ${config.qmdEnabled ? "enabled" : "disabled"}`);
	return 0;
}

export async function main(argv: string[]): Promise<number> {
	const [cmd, ...rest] = argv;
	loadStoredKey(process.env);
	const vaultRoot = resolveVaultRoot(import.meta.url);
	try {
		switch (cmd) {
			case "link":
				return cmdLink(rest, vaultRoot);
			case "save":
				return await cmdSave(rest, vaultRoot);
			case "sync":
				return cmdSync(vaultRoot);
			case "graph":
				return cmdGraph(rest, vaultRoot);
			case "view":
				return cmdView(vaultRoot);
			case "scan-diff":
				return cmdScanDiff();
			case "setup-merge":
				return cmdSetupMerge(rest, vaultRoot);
			case "status":
				return cmdStatus(vaultRoot);
			default:
				console.error(USAGE);
				return 1;
		}
	} catch (e) {
		if (e instanceof LinkError) {
			console.error(`brain: ${e.message}`);
			return 1;
		}
		throw e;
	}
}

if (isMainModule(import.meta.url)) process.exit(await main(process.argv.slice(2)));
