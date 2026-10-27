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
import { tempDir } from "./_brain-helpers.ts";

const DEFAULTS = {
	geminiModel: "gemini-3.8-flash",
	fallbackModel: "sonnet",
	qmdEnabled: true,
	maxFixRounds: 2,
	shrinkLimit: 0.4,
};

describe("loadConfig", () => {
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

	test("a vault folder that does not exist gives the defaults", () => {
		assert.deepEqual(loadConfig(join(vault, "nope")), DEFAULTS);
		mkdirSync(join(vault, "x"));
	});
});
