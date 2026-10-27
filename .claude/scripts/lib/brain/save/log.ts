/**
 * The save log: one JSON line per save in `.brain/save-log.jsonl`, with the
 * model, the token counts and the outcome. It is machine-local (`.brain/` is
 * gitignored) and never holds a key: everything written goes through
 * `redactKey` first.
 */

import { appendFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";

export type SaveLogEntry = {
	ts: string;
	project: string;
	/** The model that produced the accepted proposal (or the last one tried, on a fallback). */
	model: string;
	/** Every model a call went to, in order. */
	modelsTried: string[];
	promptTokens: number;
	outputTokens: number;
	rounds: number;
	outcome: "saved" | "fallback";
	reason?: string;
};

/** Replace every occurrence of the key in `text`, so a message built from an error can never carry it. */
export function redactKey(text: string, key: string | undefined): string {
	if (key === undefined || key.trim() === "") return text;
	return text.split(key.trim()).join("[redacted]");
}

/** Append one line. A log that cannot be written must never fail a save. */
export function appendSaveLog(vaultRoot: string, entry: SaveLogEntry, key?: string): void {
	try {
		const dir = join(vaultRoot, ".brain");
		mkdirSync(dir, { recursive: true });
		const clean: SaveLogEntry = { ...entry };
		if (clean.reason !== undefined) clean.reason = redactKey(clean.reason, key).slice(0, 300);
		appendFileSync(join(dir, "save-log.jsonl"), `${JSON.stringify(clean)}\n`, "utf8");
	} catch {
		/* best effort */
	}
}
