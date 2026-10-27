/**
 * The code graph a linked repo already has, shaped to be injected at session
 * start: the top of graphify's `GRAPH_REPORT.md` (corpus size, summary, hub
 * files) and a pointer to `graphify query`, so a session starts knowing the
 * shape of the code without reading it.
 *
 * Three more lines ride on it, each only when it applies: a stale graph (built
 * from an older commit) starts one code-only refresh in the background; a
 * plan saved some commits ago says how far behind it is; and an empty plan
 * gets a one-time offer to seed it from the report and the git log. The block
 * never runs a model and never writes anything itself.
 */

import { spawn, spawnSync } from "node:child_process";
import { closeSync, existsSync, mkdirSync, openSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { graphifyEnv } from "./graph.ts";

export const CODE_GRAPH_LIMIT = 1500;
const REFRESH_COOLDOWN_MS = 10 * 60_000;

const bytes = (s: string) => Buffer.byteLength(s, "utf8");
const short = (sha: string) => sha.slice(0, 7);

function gitOut(cwd: string, ...args: string[]): string | null {
	const r = spawnSync("git", args, { cwd, encoding: "utf8", windowsHide: true });
	return r.status === 0 ? r.stdout.trim() : null;
}

export function headCommit(repo: string): string | null {
	return gitOut(repo, "rev-parse", "HEAD");
}

/** The top of the git repo `dir` is in, or null when it is not in one. */
export function repoRoot(dir: string): string | null {
	return gitOut(dir, "rev-parse", "--show-toplevel");
}

type Report = { corpus: string[]; summary: string[]; commit: string | null; hubs: string[] };

/** The bullet lines under each `## ` heading of the report. */
function sections(text: string): Map<string, string[]> {
	const out = new Map<string, string[]>();
	let current: string[] | null = null;
	for (const line of text.split(/\r?\n/)) {
		const h = /^## (.+)$/.exec(line);
		if (h !== null) {
			current = [];
			out.set(h[1]!.trim(), current);
		} else if (current !== null && line.startsWith("- ")) {
			current.push(line.slice(2).trim());
		}
	}
	return out;
}

function readReport(repo: string): Report | null {
	let text: string;
	try {
		text = readFileSync(join(repo, "graphify-out", "GRAPH_REPORT.md"), "utf8");
	} catch {
		return null;
	}
	const s = sections(text);
	const find = (prefix: string) => [...s.entries()].find(([k]) => k.startsWith(prefix))?.[1] ?? [];
	const commitLine = find("Graph Freshness").find((l) => l.startsWith("Built from commit"));
	return {
		corpus: find("Corpus Check").filter((l) => /files/.test(l)),
		summary: find("Summary").filter((l) => /nodes/.test(l)),
		commit: commitLine === undefined ? null : (/`([0-9a-f]+)`/.exec(commitLine)?.[1] ?? null),
		hubs: find("Community Hubs"),
	};
}

/** Start `graphify update` on `repo` in the background, at most once per cooldown. */
export function refreshCodeGraph(repo: string): void {
	const out = join(repo, "graphify-out");
	const stamp = join(out, ".brain-refresh");
	try {
		if (Date.now() - statSync(stamp).mtimeMs < REFRESH_COOLDOWN_MS) return;
	} catch {
		/* never refreshed */
	}
	try {
		mkdirSync(out, { recursive: true });
		writeFileSync(stamp, `${new Date().toISOString()}\n`);
		const log = openSync(join(out, ".brain-refresh.log"), "w");
		// Code-only: no backend, so graphify cannot reach any model.
		const child = spawn("graphify", ["update", repo], {
			cwd: repo,
			env: graphifyEnv(process.env, "none"),
			detached: true,
			stdio: ["ignore", log, log],
			windowsHide: true,
		});
		child.on("error", () => {});
		child.unref();
		closeSync(log);
	} catch {
		/* a refresh is best effort; the session starts either way */
	}
}

/** How many commits HEAD is past `commit`, or null when git does not know it. */
function commitsSince(repo: string, commit: string): number | null {
	if (gitOut(repo, "cat-file", "-e", `${commit}^{commit}`) === null) return null;
	const n = Number(gitOut(repo, "rev-list", "--count", `${commit}..HEAD`));
	return Number.isFinite(n) ? n : null;
}

export function codeGraphBlock(opts: {
	repo: string;
	savedCommit?: string | null;
	planEmpty?: boolean;
	refresh?: (repo: string) => void;
}): string | null {
	const { repo } = opts;
	if (!existsSync(join(repo, "graphify-out", "GRAPH_REPORT.md"))) return null;
	const report = readReport(repo);
	if (report === null) return null;

	const head = [
		"### Code graph",
		...[...report.corpus, ...report.summary].map((l) => `- ${l}`),
	];
	const tail = [
		'For questions about how the code fits together, run `graphify query "<question>" --graph graphify-out/graph.json` before opening files; graphify-out/GRAPH_REPORT.md has the full map.',
	];

	const now = headCommit(repo);
	if (report.commit !== null && now !== null && !now.startsWith(report.commit)) {
		(opts.refresh ?? refreshCodeGraph)(repo);
		tail.push(`The graph was built at ${short(report.commit)}; HEAD is ${short(now)}. A code-only refresh (no LLM) was started in the background.`);
	}

	if (opts.savedCommit && now !== null && !now.startsWith(opts.savedCommit)) {
		const n = commitsSince(repo, opts.savedCommit);
		if (n !== null && n > 0) {
			const s = short(opts.savedCommit);
			tail.push(
				`The plan was saved at commit ${s}, ${n} commit${n === 1 ? "" : "s"} ago: run \`git log --oneline ${s}..HEAD\` before trusting it.`,
			);
		}
	}

	if (opts.planEmpty === true) {
		tail.push(
			"The plan is empty. Offer once to seed it: read graphify-out/GRAPH_REPORT.md and `git log --oneline -30`, then `save` the key context and next steps (about 15–20k tokens, once). Do nothing unless the user says yes.",
		);
	}

	// Hubs fill whatever room the fixed lines leave.
	let size = bytes([...head, ...tail].join("\n")) + 2;
	const shown: string[] = [];
	for (const hub of report.hubs) {
		const more = `(+${report.hubs.length - shown.length - 1} more in graphify-out/GRAPH_REPORT.md)`;
		const cost = bytes(hub) + 2 + bytes("Hubs: ") + bytes(more) + 2;
		if (size + cost > CODE_GRAPH_LIMIT) break;
		shown.push(hub);
		size += bytes(hub) + 2;
	}
	if (shown.length > 0) {
		const rest = report.hubs.length - shown.length;
		head.push(`Hubs: ${shown.join(", ")}${rest > 0 ? ` (+${rest} more in graphify-out/GRAPH_REPORT.md)` : ""}`);
	}
	return [...head, ...tail].join("\n");
}
