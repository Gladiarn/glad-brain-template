/**
 * The release workflow publishes a GitHub release whose notes are the tag's
 * section of CHANGELOG.md. These pin how that section is cut out.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { releaseNotes } from "../../../.github/scripts/release-notes.ts";

const CHANGELOG = [
	"# Changelog",
	"",
	"## v1.1.0 — 2026-11-01",
	"",
	"### Fixed",
	"- fix a thing",
	"",
	"## v1.0.0 — 2026-10-27",
	"",
	"### Added",
	"- first release",
	"",
	"Versions before 1.0.0 are an upstream project's history: https://example.com",
	"",
].join("\n");

test("returns the tagged version's section without its heading", () => {
	assert.equal(releaseNotes(CHANGELOG, "v1.1.0"), "### Fixed\n- fix a thing");
});

test("stops at the closing footer line after the last section", () => {
	assert.equal(releaseNotes(CHANGELOG, "v1.0.0"), "### Added\n- first release");
});

test("accepts the tag with or without the leading v", () => {
	assert.equal(releaseNotes(CHANGELOG, "1.1.0"), releaseNotes(CHANGELOG, "v1.1.0"));
});

test("throws when the changelog has no section for the tag", () => {
	assert.throws(() => releaseNotes(CHANGELOG, "v2.0.0"), /no section for v2\.0\.0/);
});

test("does not match a version that only starts the same (v1.1.0 vs v1.1.01)", () => {
	assert.throws(() => releaseNotes("# Changelog\n\n## v1.1.01 — 2026-11-01\n\n- x\n", "v1.1.0"), /no section/);
});

test("the script prints the notes for the tag it is given, and fails on a missing one", () => {
	const dir = mkdtempSync(join(tmpdir(), "gb-notes-"));
	try {
		const file = join(dir, "CHANGELOG.md");
		writeFileSync(file, CHANGELOG);
		const script = join(dirname(fileURLToPath(import.meta.url)), "../../../.github/scripts/release-notes.ts");
		const ok = spawnSync(process.execPath, ["--experimental-strip-types", script, "v1.0.0", file], { encoding: "utf8" });
		assert.equal(ok.status, 0, ok.stderr);
		assert.equal(ok.stdout, "### Added\n- first release\n");
		const bad = spawnSync(process.execPath, ["--experimental-strip-types", script, "v9.9.9", file], { encoding: "utf8" });
		assert.equal(bad.status, 1);
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});
