/**
 * The brain's settings, read from `brain.config.json` at the vault root.
 *
 * Every model name lives here and nowhere else, so changing a model is a
 * one-line edit. A missing or broken file is never an error: a hook that
 * dies on a bad config would block a session, so each field falls back to
 * its default on its own.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";

export type BrainConfig = {
	/** The first model a save tries; the notes graph uses it too. */
	geminiModel: string;
	/** Tried in order when the model before it is unavailable (quota, outage). */
	geminiFallbackModels: string[];
	/** Start the notes graph in the background after a Gemini save. */
	graphAfterSave: boolean;
	fallbackModel: "sonnet";
	qmdEnabled: boolean;
	maxFixRounds: number;
	shrinkLimit: number;
};

export const CONFIG_FILE = "brain.config.json";

export const DEFAULT_CONFIG: Readonly<BrainConfig> = {
	geminiModel: "gemini-3.5-flash-lite",
	geminiFallbackModels: ["gemini-3.1-flash-lite", "gemini-3.8-flash"],
	graphAfterSave: false,
	fallbackModel: "sonnet",
	qmdEnabled: true,
	maxFixRounds: 2,
	shrinkLimit: 0.4,
};

export function loadConfig(vaultRoot: string): BrainConfig {
	const config: BrainConfig = { ...DEFAULT_CONFIG, geminiFallbackModels: [...DEFAULT_CONFIG.geminiFallbackModels] };
	let raw: unknown;
	try {
		raw = JSON.parse(readFileSync(join(vaultRoot, CONFIG_FILE), "utf8"));
	} catch {
		return config;
	}
	if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return config;
	const o = raw as Record<string, unknown>;
	if (typeof o["geminiModel"] === "string" && o["geminiModel"].trim() !== "") {
		config.geminiModel = o["geminiModel"].trim();
	}
	const fallbacks = o["geminiFallbackModels"];
	if (Array.isArray(fallbacks) && fallbacks.every((m) => typeof m === "string" && m.trim() !== "")) {
		config.geminiFallbackModels = (fallbacks as string[]).map((m) => m.trim());
	}
	if (typeof o["graphAfterSave"] === "boolean") config.graphAfterSave = o["graphAfterSave"];
	if (typeof o["qmdEnabled"] === "boolean") config.qmdEnabled = o["qmdEnabled"];
	const rounds = o["maxFixRounds"];
	if (typeof rounds === "number" && Number.isInteger(rounds) && rounds >= 0 && rounds <= 10) {
		config.maxFixRounds = rounds;
	}
	const shrink = o["shrinkLimit"];
	if (typeof shrink === "number" && shrink > 0 && shrink < 1) config.shrinkLimit = shrink;
	return config;
}
