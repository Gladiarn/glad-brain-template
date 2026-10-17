/**
 * lib/atomic-write.ts writeFileAtomic: replace a file whole, or leave nothing behind.
 * rewriteIfUnchanged: edit an existing file without losing another writer's edit.
 */

import { test, describe, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { writeFileAtomic, rewriteIfUnchanged } from "../lib/atomic-write.ts";
import { rmTemp } from "./_helpers.ts";

describe("writeFileAtomic", () => {
	let dir = "";
	beforeEach(() => {
		dir = mkdtempSync(join(tmpdir(), "atomic-write-"));
	});
	afterEach(() => {
		rmTemp(dir);
	});

	test("writes a new file and replaces an existing one", () => {
		const path = join(dir, "state.json");
		writeFileAtomic(path, "first");
		writeFileAtomic(path, "second");
		assert.equal(readFileSync(path, "utf8"), "second");
		assert.deepEqual(readdirSync(dir), ["state.json"], "no temp file left behind");
	});

	test("a write that cannot land throws and removes its temp file", () => {
		// A directory where the file should be: the rename fails.
		const path = join(dir, "taken");
		mkdirSync(path);
		writeFileSync(join(path, "keep"), "");
		assert.throws(() => writeFileAtomic(path, "text"));
		assert.deepEqual(readdirSync(dir), ["taken"], "the temp file was removed");
	});
});

describe("rewriteIfUnchanged", () => {
	let dir = "";
	let path = "";
	beforeEach(() => {
		dir = mkdtempSync(join(tmpdir(), "atomic-write-"));
		path = join(dir, "note.md");
	});
	afterEach(() => {
		rmTemp(dir);
	});

	test("writes when the file still holds what transform read", () => {
		writeFileSync(path, "v1", "utf8");
		const outcome = rewriteIfUnchanged(path, (current) => current + "v2");
		assert.equal(outcome, "written");
		assert.equal(readFileSync(path, "utf8"), "v1v2");
		assert.deepEqual(readdirSync(dir), ["note.md"], "no temp file left behind");
	});

	test("reports unchanged and writes nothing when there is nothing to change", () => {
		writeFileSync(path, "same", "utf8");
		assert.equal(rewriteIfUnchanged(path, () => null), "unchanged");
		assert.equal(rewriteIfUnchanged(path, (current) => current), "unchanged");
		assert.equal(readFileSync(path, "utf8"), "same");
	});

	test("a file that changes under us is retried on fresh content, both edits kept", () => {
		// The issue's contention path: a competing writer lands between our read
		// and our replace. The first attempt must NOT clobber their edit.
		writeFileSync(path, "v1", "utf8");
		let calls = 0;
		const outcome = rewriteIfUnchanged(path, (current) => {
			calls++;
			if (calls === 1) {
				// Simulate the other writer: it read the same v1 and added its line.
				writeFileSync(path, current.replace("v1", "v1\nother"), "utf8");
			}
			return current + "\nmine";
		});
		assert.equal(outcome, "written");
		assert.equal(readFileSync(path, "utf8"), "v1\nother\nmine", "the competing edit must survive");
		assert.equal(calls, 2, "the edit was replayed on the fresh content");
		assert.deepEqual(readdirSync(dir), ["note.md"], "no temp file left behind");
	});

	test("a file that changes on every attempt reports contended, unwritten", () => {
		writeFileSync(path, "base", "utf8");
		let calls = 0;
		const outcome = rewriteIfUnchanged(
			path,
			(current) => {
				calls++;
				// A writer that lands during every window: the file never matches.
				writeFileSync(path, current + `x`, "utf8");
				return current + "mine";
			},
			3,
		);
		assert.equal(outcome, "contended");
		assert.equal(calls, 3, "gave up after the bounded attempts");
		assert.ok(!readFileSync(path, "utf8").includes("mine"), "nothing of ours was written");
		assert.deepEqual(readdirSync(dir), ["note.md"], "no temp file left behind");
	});
	test("a writer holding the lock makes the next one report contended, the lock left alone", () => {
		writeFileSync(path, "v1", "utf8");
		writeFileSync(`${path}.lock`, "", "utf8");
		let calls = 0;
		const outcome = rewriteIfUnchanged(
			path,
			(current) => {
				calls++;
				return current + "mine";
			},
			3,
			50,
		);
		assert.equal(outcome, "contended");
		assert.equal(calls, 0, "nothing is read for an edit before the lock is held");
		assert.equal(readFileSync(path, "utf8"), "v1");
		assert.deepEqual(
			readdirSync(dir).sort(),
			["note.md", "note.md.lock"],
			"another writer's lock is not ours to remove",
		);
	});

	test("a lock left by a dead writer is taken over", () => {
		writeFileSync(path, "v1", "utf8");
		writeFileSync(`${path}.lock`, "", "utf8");
		const longAgo = new Date(Date.now() - 60_000);
		utimesSync(`${path}.lock`, longAgo, longAgo);
		assert.equal(rewriteIfUnchanged(path, (current) => current + "v2", 3, 50), "written");
		assert.equal(readFileSync(path, "utf8"), "v1v2");
		assert.deepEqual(readdirSync(dir), ["note.md"], "the stale lock is gone, and ours released");
	});
});
