/**
 * The save pipeline: Gemini files a summary into the vault, checks its own
 * work, and a plain-script check has the last word. Any failure ends in a
 * fallback that writes nothing, so the caller can hand the same job to a
 * Claude subagent.
 *
 * A save is all or nothing: every proposed file is validated against the
 * allowed list and the sanity check before the first byte is written, and a
 * failed write is rolled back.
 */

import { existsSync, mkdirSync, readFileSync, realpathSync, unlinkSync } from "node:fs";
import { dirname, join, sep } from "node:path";
import { writeFileAtomic } from "../../atomic-write.ts";
import { loadConfig } from "../config.ts";
import { callGemini, GeminiError, selectFetch } from "./gemini.ts";
import { appendSaveLog, redactKey } from "./log.ts";
import { checkPrompt, fixPrompt, writePrompt, type FileView, type ProposedFile } from "./prompts.ts";
import { checkProposed } from "./sanity.ts";
import { allowedTargets, type SaveSummary } from "./schema.ts";

export type SaveResult = { outcome: "saved" | "fallback"; reason?: string; files: string[] };

export type SaveHooks = {
	/** Commit and push the vault after a save. A warning or a throw is reported, never fatal. */
	commitPush?: (message: string) => { warning?: string | undefined } | void;
	/** Record that this project was just saved. */
	markSaved?: (project: string) => void;
};

export type RunSaveOptions = {
	vaultRoot: string;
	summary: SaveSummary;
	fetchImpl?: typeof fetch;
	now?: Date;
	env?: NodeJS.ProcessEnv;
	timeoutMs?: number;
	hooks?: SaveHooks;
};

/** The pipeline refused a proposal; the reason is safe to show. */
class Refused extends Error {}

const MAX_FILE_BYTES = 200_000;

function readExisting(vaultRoot: string, rel: string): string | null {
	try {
		return readFileSync(join(vaultRoot, rel), "utf8");
	} catch {
		return null;
	}
}

/** Parse and validate the model's file list against the allowed targets. */
function validateFiles(raw: unknown, targets: Set<string>): ProposedFile[] {
	const files = (raw as { files?: unknown } | null)?.files;
	if (!Array.isArray(files) || files.length === 0) throw new Refused("Gemini answered with no files");
	if (files.length > targets.size) throw new Refused("Gemini answered with too many files");
	const seen = new Set<string>();
	const out: ProposedFile[] = [];
	for (const f of files as unknown[]) {
		const x = f as { path?: unknown; content?: unknown } | null;
		if (typeof x?.path !== "string" || typeof x.content !== "string") throw new Refused("Gemini answered in the wrong shape");
		if (!targets.has(x.path)) throw new Refused("Gemini proposed a path that is not in the allowed list");
		if (seen.has(x.path)) throw new Refused("Gemini proposed the same file twice");
		if (Buffer.byteLength(x.content, "utf8") > MAX_FILE_BYTES) throw new Refused("Gemini proposed an oversized file");
		seen.add(x.path);
		out.push({ path: x.path, content: x.content });
	}
	return out;
}

function validateCheck(raw: unknown): { ok: boolean; problems: string[] } {
	const x = raw as { ok?: unknown; problems?: unknown } | null;
	if (typeof x?.ok !== "boolean" || !Array.isArray(x.problems)) throw new Refused("Gemini's self-check answered in the wrong shape");
	const problems = (x.problems as unknown[]).filter((p): p is string => typeof p === "string").slice(0, 20).map((p) => p.slice(0, 500));
	return { ok: x.ok, problems };
}

/** The real path of the deepest existing ancestor, to catch a symlink out of the vault. */
function realAncestor(path: string): string {
	let p = path;
	while (!existsSync(p)) {
		const up = dirname(p);
		if (up === p) break;
		p = up;
	}
	return realpathSync(p);
}

function writeAll(vaultRoot: string, files: ProposedFile[]): void {
	const root = realpathSync(vaultRoot);
	for (const f of files) {
		const abs = join(vaultRoot, f.path);
		const anchor = realAncestor(dirname(abs));
		if (anchor !== root && !anchor.startsWith(root + sep)) throw new Refused(`${f.path} resolves outside the vault`);
	}
	const done: { abs: string; prev: string | null }[] = [];
	try {
		for (const f of files) {
			const abs = join(vaultRoot, f.path);
			const prev = readExisting(vaultRoot, f.path);
			mkdirSync(dirname(abs), { recursive: true });
			writeFileAtomic(abs, f.content);
			done.push({ abs, prev });
		}
	} catch {
		for (const d of done.reverse()) {
			try {
				if (d.prev === null) unlinkSync(d.abs);
				else writeFileAtomic(d.abs, d.prev);
			} catch {
				/* the rollback itself is best effort */
			}
		}
		throw new Refused("a file could not be written, so nothing was saved");
	}
}

export async function runSave(opts: RunSaveOptions): Promise<SaveResult> {
	const { vaultRoot, summary } = opts;
	const now = opts.now ?? new Date();
	const env = opts.env ?? process.env;
	const config = loadConfig(vaultRoot);
	const apiKey = (env["GEMINI_API_KEY"] ?? "").trim();
	const targetList = allowedTargets(vaultRoot, summary.project, now);
	const targets = new Set(targetList);
	const today = now.toISOString().slice(0, 10);
	const tally = { promptTokens: 0, outputTokens: 0, rounds: 0 };

	const finish = (outcome: SaveResult["outcome"], reason: string | undefined, files: string[]): SaveResult => {
		const safeReason = reason === undefined ? undefined : redactKey(reason, apiKey);
		appendSaveLog(
			vaultRoot,
			{
				ts: now.toISOString(),
				project: summary.project,
				model: config.geminiModel,
				...tally,
				outcome,
				...(safeReason === undefined ? {} : { reason: safeReason }),
			},
			apiKey,
		);
		return safeReason === undefined ? { outcome, files } : { outcome, reason: safeReason, files };
	};
	const fallback = (reason: string) => finish("fallback", reason, targetList);

	if (apiKey === "") return fallback("no Gemini key");
	const fetchImpl = opts.fetchImpl ?? selectFetch(env);

	const ask = async (prompt: { system: string; user: string }) => {
		const r = await callGemini({
			model: config.geminiModel,
			apiKey,
			system: prompt.system,
			user: prompt.user,
			fetchImpl,
			...(opts.timeoutMs === undefined ? {} : { timeoutMs: opts.timeoutMs }),
		});
		tally.promptTokens += r.promptTokens;
		tally.outputTokens += r.outputTokens;
		return r.json;
	};

	try {
		const views: FileView[] = targetList.map((path) => {
			const content = readExisting(vaultRoot, path);
			return { path, exists: content !== null, content: content ?? "" };
		});
		const oldFiles = views.filter((v) => v.exists);
		const accept = (raw: unknown): ProposedFile[] => {
			const files = validateFiles(raw, targets);
			const refusal = checkProposed(
				files.map((f) => ({ path: f.path, old: readExisting(vaultRoot, f.path), next: f.content })),
				config.shrinkLimit,
			);
			if (refusal !== null) throw new Refused(`sanity check: ${refusal}`);
			return files;
		};

		let proposal = accept(await ask(writePrompt(summary, targetList, views, today)));

		const checks = Math.max(1, config.maxFixRounds);
		let lastProblems: string[] = [];
		let passed = false;
		for (let round = 1; round <= checks; round++) {
			tally.rounds = round;
			const verdict = validateCheck(await ask(checkPrompt(summary, oldFiles, proposal, today)));
			if (verdict.ok) {
				passed = true;
				break;
			}
			lastProblems = verdict.problems;
			if (round < checks) proposal = accept(await ask(fixPrompt(summary, targetList, views, proposal, verdict.problems, today)));
		}
		if (!passed) return fallback(`Gemini failed its own check ${checks} times: ${lastProblems.join("; ").slice(0, 200)}`);

		writeAll(vaultRoot, proposal);
		const warnings: string[] = [];
		try {
			const pushed = opts.hooks?.commitPush?.(`brain: save ${summary.project}`);
			if (pushed && pushed.warning) warnings.push(pushed.warning);
		} catch (e) {
			warnings.push(`commit or push failed: ${(e as Error).message}`);
		}
		try {
			opts.hooks?.markSaved?.(summary.project);
		} catch (e) {
			warnings.push(`could not record the save: ${(e as Error).message}`);
		}
		return finish("saved", warnings.length > 0 ? warnings.join("; ") : undefined, proposal.map((f) => f.path));
	} catch (e) {
		if (e instanceof GeminiError || e instanceof Refused) return fallback(e.message);
		return fallback(`unexpected error: ${(e as Error).name}`);
	}
}
