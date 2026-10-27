/**
 * Claiming a filename without losing a write.
 *
 * Extracted because both write paths — memories and work records — need it, and
 * a correctness-critical pattern implemented twice is a fix applied once.
 *
 * WHY NOT check-then-write
 *
 * The obvious version is `while (existsSync(x)) bump(x); writeFileSync(x)`. It
 * is a TOCTOU race, and not a theoretical one: the deployment shape is one
 * server process PER CONSUMING REPO, all writing into one vault. Six processes
 * recording the same title produced FOUR files and SIX success messages — two
 * writes lost silently, reported as recorded, which is the worst outcome
 * available to a layer whose whole job is not losing them.
 *
 * `COPYFILE_EXCL` fails instead of clobbering, so the loser simply takes the
 * next suffix. The temp file also means a crash mid-write cannot leave a
 * half-written note for the indexer to pick up.
 */

import {
	writeFileSync,
	readFileSync,
	copyFileSync,
	renameSync,
	unlinkSync,
	openSync,
	closeSync,
	statSync,
	constants,
} from "node:fs";
import { join } from "node:path";

/** Per-process counter, so two in-flight writes cannot share a temp name. */
let tmpSeq = 0;

export interface ClaimResult {
	/** The filename that was successfully claimed. */
	readonly name: string;
	/** Its absolute path. */
	readonly full: string;
}

export interface ClaimOptions {
	/** How many suffixed names to try before giving up. */
	readonly maxAttempts?: number;
	/**
	 * Called with each candidate before it is claimed. Throw to refuse it —
	 * used by the capture path to verify containment rather than trust that a
	 * slug stripped every separator.
	 */
	readonly verify?: (full: string) => void;
	/** Message when every attempt collided. */
	readonly exhaustedMessage?: string;
}

/**
 * Write `body` into `dir` under the first free name `nameFor` produces.
 *
 * `nameFor(1)` is the preferred name; higher `n` are the collision fallbacks,
 * so the caller decides whether that looks like `note (2).md` or `note-2.md`.
 */
export function claimFile(
	dir: string,
	body: string,
	nameFor: (n: number) => string,
	{ maxAttempts = 50, verify, exhaustedMessage = "too many colliding files for that name" }: ClaimOptions = {},
): ClaimResult {
	const tmp = join(dir, `.om-${process.pid}-${++tmpSeq}.tmp`);
	writeFileSync(tmp, body, "utf8");
	try {
		for (let n = 1; n <= maxAttempts; n++) {
			const name = nameFor(n);
			const full = join(dir, name);
			verify?.(full);
			try {
				copyFileSync(tmp, full, constants.COPYFILE_EXCL);
				return { name, full };
			} catch (e) {
				if ((e as NodeJS.ErrnoException)?.code !== "EEXIST") throw e;
			}
		}
		throw new Error(exhaustedMessage);
	} finally {
		try {
			unlinkSync(tmp);
		} catch {
			/* temp cleanup is best-effort */
		}
	}
}

/**
 * Replace `path` with `text` through a temp file and a rename, so a reader
 * never sees half a file and a process killed mid-write leaves the previous
 * one. Unlike `claimFile`, it overwrites. Throws if it cannot, after removing
 * its temp file.
 */
export function writeFileAtomic(path: string, text: string): void {
	const tmp = `${path}.${process.pid}-${++tmpSeq}.tmp`;
	try {
		writeFileSync(tmp, text, "utf8");
		renameSync(tmp, path);
	} catch (err) {
		try {
			unlinkSync(tmp);
		} catch {
			/* nothing was written */
		}
		throw err;
	}
}

/** What a guarded rewrite ended up doing. */
export type RewriteResult = "written" | "unchanged" | "contended";

/**
 * Rewrite an existing file only if it is unchanged since `transform` read it.
 *
 * WHY NOT just read, edit, writeFileAtomic
 *
 * That is a read-modify-write with nothing between the read and the write that
 * notices the file changed. Two writers each read the original, each applies
 * its own edit, and the second rename erases the first — both reported as
 * written. markSuperseded lost 90 of 200 titles exactly this way (#328).
 * `writeFileAtomic` makes each replacement invisible to readers; it does
 * nothing about the lost update between them.
 *
 * WHY A LOCK FILE, and not only a re-read before the rename
 *
 * Re-reading just before replacing shrinks the window from the whole edit to
 * the gap between that read and the rename, but does not close it: four
 * processes marking one memory together still lost a title in most runs of 50
 * rounds, each reported as written. So writers going through this function
 * first take `<file>.lock` by exclusive create, the same primitive `claimFile`
 * relies on, and only one of them is ever between its read and its rename.
 *
 * The re-read stays, for writers that take no lock — a person saving the note
 * in Obsidian. If the file changed since `transform` read it, the temp is
 * thrown away and the edit replayed on the fresh content, a bounded number of
 * times. `transform` returning null means there is nothing to change.
 *
 * A held lock lasts a few filesystem calls, so one older than STALE_LOCK_MS was
 * left by a process that died holding it, and is taken over. A writer that
 * cannot get the lock within `lockWaitMs` reports `contended` — told, not
 * silently dropped.
 *
 * ON WINDOWS, renaming over or reading a file another process holds at that
 * instant throws EPERM (EBUSY and EACCES are the same sharing violation by
 * other names). An indexer or editor reading the note is enough. That is a busy
 * file, not a broken one, so it is retried after a short pause, under its own
 * bound since it says nothing about our read being stale. Only on Windows,
 * where these codes are transient; on POSIX they mean a real permission
 * problem and are thrown at once.
 */
export function rewriteIfUnchanged(
	path: string,
	transform: (current: string) => string | null,
	attempts = 3,
	lockWaitMs = LOCK_WAIT_MS,
): RewriteResult {
	const lock = `${path}.lock`;
	if (!acquireLock(lock, lockWaitMs)) return "contended";
	try {
		return replaceIfUnchanged(path, transform, attempts);
	} finally {
		releaseLock(lock);
	}
}

/** Longest a writer waits for another's lock before reporting `contended`. */
const LOCK_WAIT_MS = 5_000;
/** Age past which a lock is a dead process's leftover rather than a writer. */
const STALE_LOCK_MS = 10_000;
/** How many sharing violations one rewrite or release sits out before throwing. */
const BUSY_RETRIES = 50;

function replaceIfUnchanged(
	path: string,
	transform: (current: string) => string | null,
	attempts: number,
): RewriteResult {
	let busy = 0;
	for (let attempt = 0; attempt < attempts; ) {
		let tmp: string | null = null;
		try {
			const before = readFileSync(path, "utf8");
			const next = transform(before);
			if (next === null || next === before) return "unchanged";
			tmp = `${path}.${process.pid}-${++tmpSeq}.tmp`;
			writeFileSync(tmp, next, "utf8");
			if (readFileSync(path, "utf8") !== before) {
				attempt++; // changed under us: retry on fresh content
				continue;
			}
			renameSync(tmp, path);
			tmp = null;
			return "written";
		} catch (err) {
			if (!isSharingViolation(err) || ++busy > BUSY_RETRIES) throw err;
			pauseMs(1 + Math.random() * 4);
		} finally {
			if (tmp) {
				try {
					unlinkSync(tmp);
				} catch {
					/* nothing to clean up */
				}
			}
		}
	}
	return "contended";
}

function acquireLock(lock: string, waitMs: number): boolean {
	const deadline = Date.now() + waitMs;
	for (;;) {
		try {
			closeSync(openSync(lock, "wx"));
			return true;
		} catch (err) {
			const code = (err as NodeJS.ErrnoException)?.code;
			if (code !== "EEXIST" && !isSharingViolation(err)) throw err;
		}
		if (lockIsStale(lock)) {
			try {
				unlinkSync(lock);
			} catch {
				/* another writer took it over first */
			}
			continue;
		}
		if (Date.now() >= deadline) return false;
		pauseMs(1 + Math.random() * 4); // jittered, so waiting writers stop meeting
	}
}

function lockIsStale(lock: string): boolean {
	try {
		return Date.now() - statSync(lock).mtimeMs > STALE_LOCK_MS;
	} catch {
		return false; // gone already: the next exclusive create decides
	}
}

function releaseLock(lock: string): void {
	for (let busy = 0; ; busy++) {
		try {
			unlinkSync(lock);
			return;
		} catch (err) {
			// Left in place, it would stall every writer until it went stale.
			if (!isSharingViolation(err) || busy >= BUSY_RETRIES) return;
			pauseMs(1 + Math.random() * 4);
		}
	}
}

/** Another process holding the file at that instant, as Windows reports it. */
function isSharingViolation(err: unknown): boolean {
	if (process.platform !== "win32") return false;
	const code = (err as NodeJS.ErrnoException)?.code;
	return code === "EPERM" || code === "EBUSY" || code === "EACCES";
}

const pauseCell = new Int32Array(new SharedArrayBuffer(4));

/** Block for `ms`: the rewrite is synchronous, and so are its callers. */
function pauseMs(ms: number): void {
	Atomics.wait(pauseCell, 0, 0, ms);
}
