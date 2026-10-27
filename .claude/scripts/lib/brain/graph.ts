/**
 * graphify, held to three rules.
 *
 * 1. The default is code-only and free: `graphify update`, with every LLM
 *    backend switched off, so it can never reach a model.
 * 2. Notes go through Gemini and only Gemini, behind a count and an explicit
 *    yes. With no Gemini key it refuses; it never falls back to Claude. An
 *    earlier graphify update used up a whole Claude allowance, which is why
 *    the child process is given an explicit backend and a scrubbed
 *    environment instead of letting graphify pick one from whatever keys it
 *    finds.
 * 3. A graph problem is a message, never an exception.
 *
 * The headless command, read from `graphify --help` and the package README
 * (graphifyy 0.9.96): `graphify extract <path> --backend gemini --model <m>`
 * runs the AST pass and the Gemini semantic pass without a session, and reads
 * GEMINI_API_KEY. It is incremental: unchanged files come from graphify's
 * cache, so a first build that hits the free tier's limits resumes where it
 * stopped. `graphify update <path>` is the code-only pass, and
 * GRAPHIFY_BACKEND=none also turns off the `claude -p` community-labelling
 * fallback the extract path would otherwise be free to use.
 *
 * `extract` writes graph.json but no graph.html or report, so after it (and
 * after `update`, when graph.html is still missing) two more steps run with
 * the backend off and no key: `graphify cluster-only <vault>` then
 * `graphify export html`. If the first step fails, they do not run.
 */

import { spawn, spawnSync } from "node:child_process";
import { accessSync, closeSync, constants, existsSync, mkdirSync, openSync, readFileSync, readdirSync, statSync } from "node:fs";
import { delimiter, join, relative } from "node:path";
import { loadConfig } from "./config.ts";

export type GraphResult = { ran: boolean; message: string };

export type GraphOptions = {
	vaultRoot: string;
	notes: boolean;
	yes: boolean;
	env?: NodeJS.ProcessEnv;
	/** Start graphify and return at once, logging to `.brain/graph.log`. */
	detached?: boolean;
	/** Let graphify print its progress to this process's own output. */
	inherit?: boolean;
};

const PROVIDER_ENV = /^(ANTHROPIC_|CLAUDE_CODE_|OPENAI_|AZURE_OPENAI_|MOONSHOT_|DEEPSEEK_|OLLAMA_|AWS_)/;
const LONG_RUN_MS = 6 * 60 * 60_000;
// A Gemini that stops answering (high demand, an outage) otherwise holds a
// notes run for hours: graphify waits 600 s per request by default. Each
// request gets 60 s and the whole run 20 minutes, then the run is stopped.
const NOTES_API_TIMEOUT_S = 60;
const NOTES_RUN_MS = 20 * 60_000;

function notesRunMs(env: NodeJS.ProcessEnv): number {
	const n = Number(env["BRAIN_GRAPH_NOTES_TIMEOUT_MS"]);
	return Number.isFinite(n) && n > 0 ? n : NOTES_RUN_MS;
}

/** The env graphify gets: one explicit backend, and no key for any other provider. */
export function graphifyEnv(base: NodeJS.ProcessEnv, backend: "none" | "gemini"): NodeJS.ProcessEnv {
	const env: NodeJS.ProcessEnv = {};
	for (const [k, v] of Object.entries(base)) {
		if (v !== undefined && !PROVIDER_ENV.test(k) && k !== "GOOGLE_API_KEY") env[k] = v;
	}
	env["GRAPHIFY_BACKEND"] = backend;
	if (backend === "none") delete env["GEMINI_API_KEY"];
	return env;
}

export function findOnPath(name: string, env: NodeJS.ProcessEnv = process.env): string | null {
	for (const dir of (env["PATH"] ?? "").split(delimiter)) {
		if (dir === "") continue;
		const full = join(dir, name);
		try {
			accessSync(full, constants.X_OK);
			if (statSync(full).isFile()) return full;
		} catch {
			/* not here */
		}
	}
	return null;
}

const NOT_INSTALLED =
	"graphify is not installed; skipped the graph (run setup.sh, or `uv tool install 'graphifyy[gemini]'`)";

const GRAPH_HTML_PATH = ["graphify-out", "graph.html"];

// The background run is one shell sequence so it can chain the steps and still
// put `timeout` on the Gemini step alone. The follow-up steps run with the
// backend off and the key removed. Arguments: graphify, vault, timeout binary
// (or empty), seconds, "always" or "if-missing", then the first step's args.
const BACKGROUND_SCRIPT = [
	'g=$1; v=$2; k=$3; s=$4; f=$5; shift 5',
	'if [ -n "$k" ]; then "$k" "${s}s" "$g" "$@"; else "$g" "$@"; fi || exit $?',
	'if [ "$f" = if-missing ] && [ -f "$v/graphify-out/graph.html" ]; then exit 0; fi',
	'unset GEMINI_API_KEY',
	'GRAPHIFY_BACKEND=none "$g" cluster-only "$v" || exit $?',
	'GRAPHIFY_BACKEND=none "$g" export html',
].join("\n");

/**
 * Run graphify with `args`, waiting for it, or starting it in the background,
 * then build graph.html: always after a notes run, and after a code-only run
 * only when graph.html is missing.
 */
function runGraphify(
	opts: GraphOptions,
	args: string[],
	backend: "none" | "gemini",
	what: string,
): GraphResult {
	const base = opts.env ?? process.env;
	const bin = findOnPath("graphify", base);
	if (bin === null) return { ran: false, message: NOT_INSTALLED };
	const env = graphifyEnv(base, backend);
	const limitMs = backend === "gemini" ? notesRunMs(base) : LONG_RUN_MS;
	const htmlFile = join(opts.vaultRoot, ...GRAPH_HTML_PATH);
	const always = backend === "gemini";

	if (opts.detached === true) {
		try {
			const dir = join(opts.vaultRoot, ".brain");
			mkdirSync(dir, { recursive: true });
			const out = openSync(join(dir, "graph.log"), "a");
			// In the background nobody waits on the run, so `timeout` ends a hung one.
			const killer = backend === "gemini" ? findOnPath("timeout", base) : null;
			const argv = ["-c", BACKGROUND_SCRIPT, "sh", bin, opts.vaultRoot, killer ?? "", String(Math.ceil(limitMs / 1000)), always ? "always" : "if-missing", ...args];
			const child = spawn("/bin/sh", argv, { cwd: opts.vaultRoot, env, detached: true, stdio: ["ignore", out, out], windowsHide: true });
			child.on("error", () => {});
			child.unref();
			closeSync(out);
			return { ran: true, message: `${what} started in the background (progress in .brain/graph.log)` };
		} catch {
			return { ran: false, message: `${what} could not be started` };
		}
	}

	const r = spawnSync(bin, args, {
		cwd: opts.vaultRoot,
		env,
		encoding: "utf8",
		timeout: limitMs,
		windowsHide: true,
		stdio: opts.inherit === true ? "inherit" : "pipe",
	});
	if ((r.error as NodeJS.ErrnoException | undefined)?.code === "ETIMEDOUT" && backend === "gemini") {
		const mins = Math.max(1, Math.round(limitMs / 60_000));
		return { ran: false, message: `${what} was stopped after ${mins} min: Gemini did not answer in time (often high demand). The graph was not updated; try again later.` };
	}
	if (r.error) return { ran: false, message: `${what} did not finish (${(r.error as NodeJS.ErrnoException).code ?? "error"})` };
	if (r.status !== 0) return { ran: false, message: `${what} exited ${r.status}` };

	if (!always && existsSync(htmlFile)) return { ran: true, message: `${what} done` };
	const offEnv = graphifyEnv(base, "none");
	for (const [step, stepArgs] of [
		["cluster-only", ["cluster-only", opts.vaultRoot]],
		["export html", ["export", "html"]],
	] as const) {
		const s = spawnSync(bin, [...stepArgs], {
			cwd: opts.vaultRoot,
			env: offEnv,
			encoding: "utf8",
			timeout: LONG_RUN_MS,
			windowsHide: true,
			stdio: opts.inherit === true ? "inherit" : "pipe",
		});
		const failed = s.error ? ((s.error as NodeJS.ErrnoException).code ?? "error") : s.status !== 0 ? `exited ${s.status}` : null;
		if (failed !== null) {
			return { ran: false, message: `${what} done, but ${step} ${failed.startsWith("exited") ? failed : `did not finish (${failed})`}, so graph.html was not updated` };
		}
	}
	return { ran: true, message: `${what} done` };
}

/** `.graphifyignore` entries as a predicate over vault-relative paths (directories, names and *.ext). */
function ignorer(vaultRoot: string): (rel: string) => boolean {
	let entries: string[] = [];
	try {
		entries = readFileSync(join(vaultRoot, ".graphifyignore"), "utf8")
			.split("\n")
			.map((l) => l.trim())
			.filter((l) => l !== "" && !l.startsWith("#"));
	} catch {
		/* none */
	}
	return (rel) => {
		const parts = rel.split("/");
		return entries.some((e) => {
			if (e.startsWith("*.")) return rel.endsWith(e.slice(1));
			const dir = e.replace(/\/+$/, "");
			if (dir.includes("/")) return rel === dir || rel.startsWith(`${dir}/`);
			return parts.includes(dir);
		});
	};
}

/** The notes graphify would send: Markdown not ignored, changed since the last graph build. */
/** With `all`, every note graphify would read, whether or not it changed. */
export function changedNotes(vaultRoot: string, opts: { all?: boolean } = {}): string[] {
	const ignored = ignorer(vaultRoot);
	let since = 0;
	try {
		if (opts.all !== true) since = statSync(join(vaultRoot, "graphify-out", "graph.json")).mtimeMs;
	} catch {
		/* never built: every note counts */
	}
	const out: string[] = [];
	const walk = (dir: string) => {
		for (const e of readdirSync(dir, { withFileTypes: true })) {
			if (e.name === ".git" || e.name === "node_modules" || e.name === "graphify-out") continue;
			const full = join(dir, e.name);
			const rel = relative(vaultRoot, full).split("\\").join("/");
			if (ignored(rel)) continue;
			if (e.isDirectory()) walk(full);
			else if (e.name.toLowerCase().endsWith(".md") && statSync(full).mtimeMs > since) out.push(rel);
		}
	};
	walk(vaultRoot);
	return out;
}

export function graphCommand(opts: GraphOptions): GraphResult {
	const env = opts.env ?? process.env;
	if (!opts.notes) {
		return runGraphify(opts, ["update", opts.vaultRoot], "none", "code-only graph update (no LLM)");
	}

	const config = loadConfig(opts.vaultRoot);
	const changed = changedNotes(opts.vaultRoot);
	if (changed.length === 0) return { ran: false, message: "no notes changed since the last graph build; nothing to send to Gemini" };
	if (!opts.yes) {
		return {
			ran: false,
			message: `${changed.length} changed note${changed.length === 1 ? "" : "s"} would be sent to Gemini (${config.geminiModel}) to update the notes graph. Nothing was run; add --yes to go ahead.`,
		};
	}
	if ((env["GEMINI_API_KEY"] ?? "").trim() === "") {
		return {
			ran: false,
			message:
				"GEMINI_API_KEY is not set, so the notes graph was not built. Notes only ever go through Gemini; I will not fall back to Claude.",
		};
	}
	return runGraphify(
		opts,
		["extract", opts.vaultRoot, "--backend", "gemini", "--model", config.geminiModel, "--api-timeout", String(NOTES_API_TIMEOUT_S)],
		"gemini",
		"notes graph update through Gemini",
	);
}

/**
 * Open the graph in the Windows browser from WSL: wslview, then explorer.exe
 * with the Windows path, then xdg-open. explorer.exe exits 1 when it works,
 * so a run that exits 0 or 1 counts as opened.
 */
export function viewGraph(opts: { vaultRoot: string; env?: NodeJS.ProcessEnv }): { opened: boolean; message: string } {
	const env = opts.env ?? process.env;
	const file = join(opts.vaultRoot, ...GRAPH_HTML_PATH);
	if (!existsSync(file)) return { opened: false, message: "no graph yet: run brain graph first" };

	const run = (name: string, args: string[]) => {
		const bin = findOnPath(name, env);
		if (bin === null) return null;
		return spawnSync(bin, args, { env, encoding: "utf8", timeout: 20_000, windowsHide: true });
	};

	const viaWslview = run("wslview", [file]);
	if (viaWslview !== null && viaWslview.status === 0) return { opened: true, message: "opened with wslview" };

	if (findOnPath("explorer.exe", env) !== null) {
		const win = run("wslpath", ["-w", file]);
		const winPath = win !== null && win.status === 0 ? win.stdout.trim() : "";
		if (winPath !== "") {
			const viaExplorer = run("explorer.exe", [winPath]);
			if (viaExplorer !== null && (viaExplorer.status === 0 || viaExplorer.status === 1)) {
				return { opened: true, message: "opened with explorer.exe" };
			}
		}
	}

	const viaXdg = run("xdg-open", [file]);
	if (viaXdg !== null && viaXdg.status === 0) return { opened: true, message: "opened with xdg-open" };
	return { opened: false, message: `could not open a browser; open ${file} by hand` };
}
