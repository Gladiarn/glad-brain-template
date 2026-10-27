/**
 * The project's own identity: it is Glad Brain, at the version its CHANGELOG
 * names. A release changes the manifest, the plugin and the changelog
 * together; between releases they must agree.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const repo = join(dirname(fileURLToPath(import.meta.url)), "../../..");
const read = (rel: string): string => readFileSync(join(repo, rel), "utf-8");
const manifest = JSON.parse(read("vault-manifest.json")) as { template: string; version: string; released: string };

test("the manifest names this project", () => {
	assert.equal(manifest.template, "glad-brain");
});

test("the newest CHANGELOG section is the manifest's version and release date", () => {
	const m = /^## v(\d+\.\d+\.\d+) — (\d{4}-\d{2}-\d{2})$/m.exec(read("CHANGELOG.md"));
	assert.ok(m, "CHANGELOG.md has no `## vX.Y.Z — YYYY-MM-DD` section");
	assert.equal(m[1], manifest.version);
	assert.equal(m[2], manifest.released);
});
