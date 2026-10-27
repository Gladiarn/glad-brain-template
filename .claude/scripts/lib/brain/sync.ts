/**
 * Keeping the brain the same on both PCs, through git.
 *
 * Nothing here ever blocks a session or overwrites a note. A pull that cannot
 * finish cleanly is undone and reported, with the working tree and HEAD back
 * exactly as they were. A push that fails is reported and retried by the next
 * save. Warnings are built from fixed phrases, never from git's own output,
 * so a credential in a remote url can not reach one.
 */

import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, openSync, closeSync, statSync, unlinkSync, writeSync } from "node:fs";
import { join } from "node:path";

export type PullResult = { ok: true } | { ok: false; warning: string; conflicts?: string[] };
export type PushResult = { pushed: boolean; warning?: string };

const GIT_TIMEOUT_MS = 15_000;

type GitRun = { code: number; stdout: string; stderr: string };

function git(vaultRoot: string, args: string[], timeoutMs = GIT_TIMEOUT_MS): GitRun {
	const r = spawnSync("git", ["-C", vaultRoot, ...args], {
		encoding: "utf8",
		timeout: timeoutMs,
		windowsHide: true,
		env: {
			...process.env,
			GIT_TERMINAL_PROMPT: "0",
			GIT_SSH_COMMAND: process.env["GIT_SSH_COMMAND"] ?? "ssh -o BatchMode=yes -o ConnectTimeout=10",
		},
	});
	return { code: r.error || r.status === null ? -1 : r.status, stdout: r.stdout ?? "", stderr: r.stderr ?? "" };
}

const isRepo = (v: string) => git(v, ["rev-parse", "--git-dir"]).code === 0;
const hasOrigin = (v: string) => git(v, ["remote"]).stdout.split("\n").includes("origin");
const hasUpstream = (v: string) => git(v, ["rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{u}"]).code === 0;
const stashCount = (v: string) => git(v, ["stash", "list"]).stdout.split("\n").filter((l) => l !== "").length;
const unmerged = (v: string) =>
	git(v, ["diff", "--name-only", "--diff-filter=U"]).stdout.split("\n").filter((l) => l !== "");

function rebaseInProgress(vaultRoot: string): boolean {
	const dir = git(vaultRoot, ["rev-parse", "--git-dir"]).stdout.trim();
	const abs = dir.startsWith("/") ? dir : join(vaultRoot, dir);
	return existsSync(join(abs, "rebase-merge")) || existsSync(join(abs, "rebase-apply"));
}

/** Put the repo back as it was before a pull that did not finish cleanly. */
function restore(vaultRoot: string, headBefore: string, stashesBefore: number): void {
	if (rebaseInProgress(vaultRoot)) git(vaultRoot, ["rebase", "--abort"]);
	if (git(vaultRoot, ["rev-parse", "HEAD"]).stdout.trim() !== headBefore) {
		git(vaultRoot, ["reset", "--hard", headBefore]);
	}
	// The pull stashed the owner's unsaved edits and could not put them back on
	// the new HEAD. On the old HEAD they apply cleanly.
	if (stashCount(vaultRoot) > stashesBefore) git(vaultRoot, ["stash", "pop", "--quiet"]);
}

export function pull(vaultRoot: string): PullResult {
	if (!isRepo(vaultRoot) || !hasOrigin(vaultRoot)) return { ok: true };
	const headBefore = git(vaultRoot, ["rev-parse", "HEAD"]).stdout.trim();
	if (headBefore === "") return { ok: true };

	const fetched = git(vaultRoot, ["fetch", "--quiet", "origin"]);
	if (fetched.code !== 0) {
		return { ok: false, warning: "could not reach the brain's git remote (offline?); working from the local copy" };
	}
	if (!hasUpstream(vaultRoot)) return { ok: true };
	const behind = Number(git(vaultRoot, ["rev-list", "--count", "HEAD..@{u}"]).stdout.trim());
	if (!(behind > 0)) return { ok: true };

	const stashesBefore = stashCount(vaultRoot);
	const pulled = git(vaultRoot, ["pull", "--rebase", "--autostash", "--quiet"]);
	const conflicts = unmerged(vaultRoot);
	const half = rebaseInProgress(vaultRoot) || stashCount(vaultRoot) > stashesBefore;
	if (pulled.code === 0 && conflicts.length === 0 && !half) return { ok: true };

	restore(vaultRoot, headBefore, stashesBefore);
	if (conflicts.length > 0) {
		return {
			ok: false,
			conflicts,
			warning: `pull stopped by a conflict: both PCs changed ${conflicts.join(", ")}. Nothing was overwritten and your local copy is untouched; resolve it in the vault with git, then pull again`,
		};
	}
	return { ok: false, warning: "pulling the brain from its git remote failed; working from the local copy" };
}

function firstLine(text: string): string {
	return text.split("\n").find((l) => l.trim() !== "")?.trim().slice(0, 200) ?? "";
}

export function commitPush(vaultRoot: string, message: string): PushResult {
	if (!isRepo(vaultRoot)) return { pushed: false, warning: "the vault is not a git repository; nothing was committed" };

	if (git(vaultRoot, ["status", "--porcelain"]).stdout.trim() !== "") {
		git(vaultRoot, ["add", "-A"]);
		const committed = git(vaultRoot, ["commit", "-q", "-m", message]);
		if (committed.code !== 0) {
			const why = firstLine(committed.stderr) || firstLine(committed.stdout);
			return { pushed: false, warning: `commit failed${why === "" ? "" : `: ${why}`}; the notes are saved but not committed` };
		}
	}

	if (!hasOrigin(vaultRoot)) {
		return { pushed: false, warning: "no git remote named origin; committed locally only" };
	}
	const push = () =>
		hasUpstream(vaultRoot) ? git(vaultRoot, ["push", "--quiet"]) : git(vaultRoot, ["push", "--quiet", "-u", "origin", "HEAD"]);

	if (push().code === 0) return { pushed: true };
	// The other PC may have pushed first: bring that in, then try once more.
	const synced = pull(vaultRoot);
	if (!synced.ok) {
		return {
			pushed: false,
			warning: `push failed: ${synced.warning}. The save is committed locally and will be pushed by the next save`,
		};
	}
	if (push().code === 0) return { pushed: true };
	return { pushed: false, warning: "push failed (offline?); the save is committed locally and will be pushed by the next save" };
}

export type LockOptions = { waitMs?: number; staleMs?: number; pollMs?: number };

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * Run `fn` with the vault's save lock held, so two sessions on one PC never
 * race git. The lock is a file created exclusively; one that is older than
 * `staleMs` was left by a crashed save and is taken over. Waits up to
 * `waitMs` for the lock, then gives up with "busy" without running `fn`.
 */
export async function withSaveLock<T>(
	vaultRoot: string,
	fn: () => Promise<T>,
	opts: LockOptions = {},
): Promise<T | "busy"> {
	const waitMs = opts.waitMs ?? 30_000;
	const staleMs = opts.staleMs ?? 10 * 60_000;
	const pollMs = opts.pollMs ?? 50;
	const dir = join(vaultRoot, ".brain");
	const lock = join(dir, "save.lock");
	mkdirSync(dir, { recursive: true });

	const deadline = Date.now() + waitMs;
	for (;;) {
		try {
			const fd = openSync(lock, "wx");
			writeSync(fd, `${process.pid} ${new Date().toISOString()}\n`);
			closeSync(fd);
			break;
		} catch (e) {
			if ((e as NodeJS.ErrnoException).code !== "EEXIST") throw e;
		}
		try {
			if (Date.now() - statSync(lock).mtimeMs > staleMs) {
				unlinkSync(lock);
				continue;
			}
		} catch {
			continue; // it was released between the two calls
		}
		if (Date.now() >= deadline) return "busy";
		await sleep(pollMs);
	}
	try {
		return await fn();
	} finally {
		try {
			unlinkSync(lock);
		} catch {
			/* already gone */
		}
	}
}
