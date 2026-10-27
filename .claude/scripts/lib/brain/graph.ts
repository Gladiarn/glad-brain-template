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

/** Run graphify with `args`, waiting for it, or starting it in the background. */
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

	if (opts.detached === true) {
		try {
			const dir = join(opts.vaultRoot, ".brain");
			mkdirSync(dir, { recursive: true });
			const out = openSync(join(dir, "graph.log"), "a");
			const child = spawn(bin, args, { cwd: opts.vaultRoot, env, detached: true, stdio: ["ignore", out, out], windowsHide: true });
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
		timeout: LONG_RUN_MS,
		windowsHide: true,
		stdio: opts.inherit === true ? "inherit" : "pipe",
	});
	if (r.error) return { ran: false, message: `${what} did not finish (${(r.error as NodeJS.ErrnoException).code ?? "error"})` };
	if (r.status !== 0) return { ran: false, message: `${what} exited ${r.status}` };
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
export function changedNotes(vaultRoot: string): string[] {
	const ignored = ignorer(vaultRoot);
	let since = 0;
	try {
		since = statSync(join(vaultRoot, "graphify-out", "graph.json")).mtimeMs;
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
		["extract", opts.vaultRoot, "--backend", "gemini", "--model", config.geminiModel],
		"gemini",
		"notes graph update through Gemini",
	);
}

const GRAPH_HTML = ["graphify-out", "graph.html"];

/**
 * Open the graph in the Windows browser from WSL: wslview, then explorer.exe
 * with the Windows path, then xdg-open. explorer.exe exits 1 when it works,
 * so a run that exits 0 or 1 counts as opened.
 */
export function viewGraph(opts: { vaultRoot: string; env?: NodeJS.ProcessEnv }): { opened: boolean; message: string } {
	const env = opts.env ?? process.env;
	const file = join(opts.vaultRoot, ...GRAPH_HTML);
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
