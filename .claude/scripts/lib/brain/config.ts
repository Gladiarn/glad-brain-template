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
	geminiModel: string;
	fallbackModel: "sonnet";
	qmdEnabled: boolean;
	maxFixRounds: number;
	shrinkLimit: number;
};

export const CONFIG_FILE = "brain.config.json";

export const DEFAULT_CONFIG: Readonly<BrainConfig> = {
	geminiModel: "gemini-3.8-flash",
	fallbackModel: "sonnet",
	qmdEnabled: true,
	maxFixRounds: 2,
	shrinkLimit: 0.4,
};

export function loadConfig(vaultRoot: string): BrainConfig {
	const config: BrainConfig = { ...DEFAULT_CONFIG };
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
	if (typeof o["qmdEnabled"] === "boolean") config.qmdEnabled = o["qmdEnabled"];
	const rounds = o["maxFixRounds"];
	if (typeof rounds === "number" && Number.isInteger(rounds) && rounds >= 0 && rounds <= 10) {
		config.maxFixRounds = rounds;
	}
	const shrink = o["shrinkLimit"];
	if (typeof shrink === "number" && shrink > 0 && shrink < 1) config.shrinkLimit = shrink;
	return config;
}
