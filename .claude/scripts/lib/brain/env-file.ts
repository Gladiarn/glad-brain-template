/**
 * The brain's per-PC env file, `~/.config/second-brain/.env`, written by
 * setup.sh. A shell loads it at startup, so a terminal (or a Claude Code
 * session) opened before setup stored the key does not have it. Reading the
 * file directly means a save never falls back to Claude just because the
 * shell is older than the key.
 */

import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

/** BRAIN_ENV_FILE overrides the location; the test runner points it at nothing. */
export function envFilePath(env: NodeJS.ProcessEnv = process.env): string {
	const override = env["BRAIN_ENV_FILE"];
	if (override !== undefined && override !== "") return override;
	return join(env["HOME"] || homedir(), ".config", "second-brain", ".env");
}

/** The key stored in the env file, or null when there is none. */
export function readStoredKey(env: NodeJS.ProcessEnv = process.env): string | null {
	let text: string;
	try {
		text = readFileSync(envFilePath(env), "utf8");
	} catch {
		return null;
	}
	let key: string | null = null;
	for (const line of text.split("\n")) {
		const m = /^GEMINI_API_KEY='?([A-Za-z0-9._-]+)'?\s*$/.exec(line);
		if (m) key = m[1]!;
	}
	return key;
}

/** Fill GEMINI_API_KEY from the env file when the environment lacks it. */
export function loadStoredKey(env: NodeJS.ProcessEnv = process.env): void {
	if ((env["GEMINI_API_KEY"] ?? "") !== "") return;
	const key = readStoredKey(env);
	if (key !== null) env["GEMINI_API_KEY"] = key;
}
