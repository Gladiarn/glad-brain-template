/**
 * The Claude Code mod is named `glad-brain`. Claude Code takes the label it
 * draws under an answer ("glad-brain: vault check: ..."), the keys of its
 * per-session state and the `enabledPlugins` entry that switches it off from
 * that one name, so the folder, plugin.json, the code and the docs must all
 * agree on it.
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const REPO = join(dirname(fileURLToPath(import.meta.url)), "../../..");
const MOD = join(REPO, ".claude/skills/glad-brain");

function filesUnder(dir: string): string[] {
	return readdirSync(dir).flatMap((n) => {
		const p = join(dir, n);
		return statSync(p).isDirectory() ? filesUnder(p) : [p];
	});
}

describe("the mod's name", () => {
	test("lives in .claude/skills/glad-brain, and the old folder is gone", () => {
		assert.ok(existsSync(join(MOD, ".claude-plugin/plugin.json")));
		assert.ok(!existsSync(join(REPO, ".claude/skills/obsidian-mind")));
	});

	test("plugin.json names it glad-brain, matching its folder", () => {
		const plugin = JSON.parse(readFileSync(join(MOD, ".claude-plugin/plugin.json"), "utf-8")) as { name: string; version: string };
		assert.equal(plugin.name, "glad-brain");
		assert.equal(plugin.name, MOD.split("/").pop());
	});

	test("plugin.json carries the template's version", () => {
		const plugin = JSON.parse(readFileSync(join(MOD, ".claude-plugin/plugin.json"), "utf-8")) as { version: string };
		const manifest = JSON.parse(readFileSync(join(REPO, "vault-manifest.json"), "utf-8")) as { version: string };
		assert.equal(plugin.version, manifest.version);
	});

	test("nothing in the mod's folder still says obsidian-mind: the state keys, the label and the type declarations use glad-brain", () => {
		const offenders = filesUnder(MOD).filter((f) => /obsidian-mind/i.test(readFileSync(f, "utf-8")));
		assert.deepEqual(offenders.map((f) => f.slice(REPO.length + 1)), []);
	});

	test("the state keys are glad-brain.*", () => {
		const register = readFileSync(join(MOD, "hooks/register.ts"), "utf-8");
		for (const key of ["context", "queued", "urgentSpent", "generation", "inFlight"]) {
			assert.match(register, new RegExp(`plugin: "glad-brain", key: "${key}"`));
		}
	});

	test("every doc that tells the user to switch it off uses the glad-brain key", () => {
		for (const rel of ["README.md", "ARCHITECTURE.md", "AGENTS.md", ".claude/rules/hooks-and-mod.md", ".github/scripts/delivery-gate.ts"]) {
			const text = readFileSync(join(REPO, rel), "utf-8");
			assert.doesNotMatch(text, /obsidian-mind@skills-dir/, rel);
		}
		assert.match(readFileSync(join(REPO, "README.md"), "utf-8"), /"glad-brain@skills-dir": false/);
	});

	test("README's validate block, mod.yml and the release workflow point at the new folder", () => {
		for (const rel of ["README.md", ".github/workflows/mod.yml", ".github/workflows/test.yml", ".github/workflows/release.yml", ".github/scripts/generate-changelog.ts"]) {
			assert.doesNotMatch(readFileSync(join(REPO, rel), "utf-8"), /skills\/obsidian-mind/, rel);
		}
	});
});
