/**
 * Tests for the brain config: defaults, overrides, and what happens when the
 * file is missing, broken, or wrong in one field.
 */

import { test, describe, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { loadConfig } from "../lib/brain/config.ts";
import { rmTemp } from "./_helpers.ts";
import { tempDir, WSL_ONLY } from "./_brain-helpers.ts";

const DEFAULTS = {
	geminiModel: "gemini-3.5-flash-lite",
	geminiFallbackModels: ["gemini-3.1-flash-lite", "gemini-3.8-flash"],
	graphAfterSave: false,
	fallbackModel: "sonnet",
	qmdEnabled: true,
	maxFixRounds: 2,
	shrinkLimit: 0.4,
};

describe("loadConfig", { skip: WSL_ONLY }, () => {
	let vault: string;
	beforeEach(() => {
		vault = tempDir("brain-config-");
	});
	afterEach(() => rmTemp(vault));

	test("a missing file gives the defaults", () => {
		assert.deepEqual(loadConfig(vault), DEFAULTS);
	});

	test("invalid JSON gives the defaults", () => {
		writeFileSync(join(vault, "brain.config.json"), "{ not json");
		assert.deepEqual(loadConfig(vault), DEFAULTS);
	});

	test("a JSON value that is not an object gives the defaults", () => {
		writeFileSync(join(vault, "brain.config.json"), "[1, 2]");
		assert.deepEqual(loadConfig(vault), DEFAULTS);
	});

	test("valid fields override the defaults", () => {
		writeFileSync(
			join(vault, "brain.config.json"),
			JSON.stringify({ geminiModel: "gemini-x", qmdEnabled: false, maxFixRounds: 1, shrinkLimit: 0.25 }),
		);
		assert.deepEqual(loadConfig(vault), {
			geminiModel: "gemini-x",
			geminiFallbackModels: DEFAULTS.geminiFallbackModels,
			graphAfterSave: false,
			fallbackModel: "sonnet",
			qmdEnabled: false,
			maxFixRounds: 1,
			shrinkLimit: 0.25,
		});
	});

	test("a wrongly typed field falls back alone, the rest still apply", () => {
		writeFileSync(
			join(vault, "brain.config.json"),
			JSON.stringify({ geminiModel: 42, qmdEnabled: false, maxFixRounds: "two", shrinkLimit: 5 }),
		);
		assert.deepEqual(loadConfig(vault), { ...DEFAULTS, qmdEnabled: false });
	});

	test("an empty model name and a negative round count fall back", () => {
		writeFileSync(join(vault, "brain.config.json"), JSON.stringify({ geminiModel: "  ", maxFixRounds: -1 }));
		assert.deepEqual(loadConfig(vault), DEFAULTS);
	});

	test("geminiFallbackModels and graphAfterSave can be set", () => {
		writeFileSync(join(vault, "brain.config.json"), JSON.stringify({ geminiFallbackModels: [" a ", "b"], graphAfterSave: true }));
		const c = loadConfig(vault);
		assert.deepEqual(c.geminiFallbackModels, ["a", "b"]);
		assert.equal(c.graphAfterSave, true);
	});

	test("an empty fallback list is allowed: saves then go straight to Claude", () => {
		writeFileSync(join(vault, "brain.config.json"), JSON.stringify({ geminiFallbackModels: [] }));
		assert.deepEqual(loadConfig(vault).geminiFallbackModels, []);
	});

	test("a bad fallback list or graphAfterSave falls back to the defaults", () => {
		for (const bad of [["ok", 3], "model", ["ok", " "], { a: 1 }, null]) {
			writeFileSync(join(vault, "brain.config.json"), JSON.stringify({ geminiFallbackModels: bad, graphAfterSave: "yes" }));
			assert.deepEqual(loadConfig(vault), DEFAULTS);
		}
	});

	test("a vault folder that does not exist gives the defaults", () => {
		assert.deepEqual(loadConfig(join(vault, "nope")), DEFAULTS);
		mkdirSync(join(vault, "x"));
	});
});
