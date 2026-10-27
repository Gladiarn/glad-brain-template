/**
 * Noticing a session that was never saved.
 *
 * `markSaved` leaves a timestamp per project, machine-local. At the next
 * session start the transcripts Claude Code keeps for the folder are
 * compared with it: a transcript that began after the last save belongs to a
 * session whose progress may be missing from the plan. The reminder offers a
 * way to record it and never writes anything itself.
 */

import { mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { isValidProjectName } from "./project.ts";

/** Where Claude Code keeps the transcripts for sessions started in `sessionDir`. */
export function transcriptsDirFor(sessionDir: string, home: string = homedir()): string {
	return join(home, ".claude", "projects", sessionDir.replace(/[^A-Za-z0-9]/g, "-"));
}

export function markSaved(vaultRoot: string, project: string, now: Date = new Date()): void {
	if (!isValidProjectName(project)) throw new Error(`not a usable project name: ${project}`);
	const dir = join(vaultRoot, ".brain", "last-save");
	mkdirSync(dir, { recursive: true });
	writeFileSync(join(dir, project), `${now.toISOString()}\n`, "utf8");
}

function lastSaveMs(vaultRoot: string, project: string): number | null {
	try {
		const t = Date.parse(readFileSync(join(vaultRoot, ".brain", "last-save", project), "utf8").trim());
		return Number.isFinite(t) ? t : null;
	} catch {
		return null;
	}
}

const localDay = (ms: number): string => {
	const d = new Date(ms);
	const pad = (n: number) => String(n).padStart(2, "0");
	return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};

export function unsavedReminder(
	vaultRoot: string,
	project: string,
	transcriptsDir: string,
	currentSessionId: string | null,
): string | null {
	let names: string[];
	try {
		names = readdirSync(transcriptsDir).filter((n) => n.endsWith(".jsonl"));
	} catch {
		return null;
	}
	const saved = lastSaveMs(vaultRoot, project);
	let latest: number | null = null;
	for (const name of names) {
		if (currentSessionId !== null && name === `${currentSessionId}.jsonl`) continue;
		let st;
		try {
			st = statSync(join(transcriptsDir, name));
		} catch {
			continue;
		}
		if (st.size === 0) continue;
		// A session that started before the last save contains it: whatever it
		// did after is not reported. One that began after it is.
		if (saved !== null) {
			const began = st.birthtimeMs > 0 && st.birthtimeMs <= st.mtimeMs ? st.birthtimeMs : st.mtimeMs;
			if (began <= saved) continue;
		}
		if (latest === null || st.mtimeMs > latest) latest = st.mtimeMs;
	}
	if (latest === null) return null;
	return [
		"### Earlier session not recorded",
		`The last session in project \`${project}\` (${localDay(latest)}) has no save on record, so its progress may be missing from the plan above.`,
		"Mention this to the user once and offer to record anything from it: they can say `save: <what to keep>`. Record nothing unless they ask.",
	].join("\n");
}
