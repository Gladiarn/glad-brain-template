/**
 * Tests for the secret guard: what counts as a secret, that a hit is
 * reported by rule and line and never by value, and the pre-commit hook that
 * blocks a commit holding one. Every key here is an obviously fake one.
 */

import { test, describe, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, symlinkSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { scanDiff, scanForSecrets } from "../lib/brain/secrets.ts";
import { rmTemp } from "./_helpers.ts";
import { GIT_ENV, REPO_ROOT, git, makeBin, makeRepo, WSL_ONLY } from "./_brain-helpers.ts";

const GEMINI = "AIza" + "FAKE".repeat(8) + "FAK"; // 4 + 35 characters
const GITHUB = "ghp_" + "F".repeat(36);
const OPENAI = "sk-" + "FAKE".repeat(6);
const SLACK = "xoxb-" + "0".repeat(12);
const PRIVATE_KEY = "-----BEGIN RSA PRIVATE KEY-----";

describe("scanForSecrets", { skip: WSL_ONLY }, () => {
	test("a Gemini key and a GitHub token are found with their line numbers", () => {
		const text = `# notes\nthe key is ${GEMINI}\n\nand a token ${GITHUB} here\n`;
		const hits = scanForSecrets(text);
		assert.deepEqual(
			hits.map((h) => [h.rule, h.line]),
			[
				["gemini-key", 2],
				["github-token", 4],
			],
		);
	});

	test("a new-format Google key (AQ. prefix) is found", () => {
		const hits = scanForSecrets("GEMINI_API_KEY=AQ.FAKEfakeFAKEfake_FAKE-fakeFAKEfakeFAKEfake\n");
		assert.deepEqual(hits.map((h) => [h.rule, h.line]), [["gemini-key", 1]]);
	});

	test("ordinary dotted words are not flagged as new-format keys", () => {
		assert.deepEqual(scanForSecrets("see FAQ.md and AQ.short for details"), []);
	});

	test("an OpenAI-style key, a Slack token and a private key header are found", () => {
		assert.deepEqual(scanForSecrets(`x ${OPENAI}`).map((h) => h.rule), ["openai-key"]);
		assert.deepEqual(scanForSecrets(`x ${SLACK}`).map((h) => h.rule), ["slack-token"]);
		assert.deepEqual(scanForSecrets(`${PRIVATE_KEY}\nabc`).map((h) => h.rule), ["private-key"]);
		assert.deepEqual(scanForSecrets("-----BEGIN PRIVATE KEY-----").map((h) => h.rule), ["private-key"]);
	});

	test("every GitHub token prefix is found", () => {
		for (const p of ["ghp_", "gho_", "ghu_", "ghs_", "ghr_"]) {
			assert.equal(scanForSecrets(`${p}${"A".repeat(36)}`).length, 1, p);
		}
	});

	test("ordinary prose, hex colours and near misses are not flagged", () => {
		const clean = [
			"Use the color #AIzaff for the button, and #1a2b3c for the border.",
			"We task-managed the desk-lamp rollout: sk-8 is a model number.",
			"AIza is how the key starts but a real one is longer",
			`short ${"AIza" + "A".repeat(34)}`,
			`short ${"ghp_" + "A".repeat(35)}`,
			"The ghost_town page and ghp are fine.",
			"-----BEGIN CERTIFICATE-----",
			"Slack uses xox tokens, not xoxz-anything.",
		];
		for (const line of clean) assert.deepEqual(scanForSecrets(line), [], line);
	});

	test("a key longer than the minimum is still found", () => {
		assert.equal(scanForSecrets(`${GEMINI}EXTRA`).length, 1);
	});

	test("two keys of different kinds on one line are two hits, the same kind twice is one", () => {
		assert.equal(scanForSecrets(`${GEMINI} ${GITHUB}`).length, 2);
		assert.equal(scanForSecrets(`${GEMINI} ${GEMINI}`).length, 1);
	});

	test("line numbers hold for CRLF text", () => {
		assert.equal(scanForSecrets(`a\r\nb\r\n${GEMINI}\r\n`)[0]?.line, 3);
	});

	test("a hit never carries the value", () => {
		const out = JSON.stringify(scanForSecrets(`x ${GEMINI} ${GITHUB} ${OPENAI}`));
		for (const v of [GEMINI, GITHUB, OPENAI, "FAKEFAKE"]) assert.ok(!out.includes(v), v);
	});

	test("empty input has no hits", () => {
		assert.deepEqual(scanForSecrets(""), []);
	});
});

describe("scanDiff", { skip: WSL_ONLY }, () => {
	const diff = (...lines: string[]) => lines.join("\n") + "\n";

	test("flags a secret on an added line with the file and the new line number", () => {
		const d = diff(
			"diff --git a/notes/a.md b/notes/a.md",
			"--- a/notes/a.md",
			"+++ b/notes/a.md",
			"@@ -1,2 +1,4 @@",
			" unchanged",
			"+new line",
			`+key ${GEMINI}`,
			" tail",
		);
		assert.deepEqual(scanDiff(d), [{ file: "notes/a.md", line: 3, rule: "gemini-key" }]);
	});

	test("ignores removed and context lines, and the +++ header", () => {
		const d = diff(
			"--- a/x.md",
			`+++ b/${GEMINI}.md`,
			"@@ -1,2 +1,1 @@",
			`-old ${GEMINI}`,
			` context ${GITHUB}`,
		);
		assert.deepEqual(scanDiff(d), []);
	});

	test("tracks several files and hunks", () => {
		const d = diff(
			"--- a/a.md",
			"+++ b/a.md",
			"@@ -0,0 +1,1 @@",
			"+fine",
			"--- a/b.md",
			"+++ b/b.md",
			"@@ -5,1 +5,2 @@",
			" ctx",
			`+${GITHUB}`,
			"@@ -20,0 +21,1 @@",
			`+${OPENAI}`,
		);
		assert.deepEqual(scanDiff(d), [
			{ file: "b.md", line: 6, rule: "github-token" },
			{ file: "b.md", line: 21, rule: "openai-key" },
		]);
	});

	test("a new file starts at line 1", () => {
		const d = diff("--- /dev/null", "+++ b/new.md", "@@ -0,0 +1,2 @@", "+one", `+${SLACK}`);
		assert.deepEqual(scanDiff(d), [{ file: "new.md", line: 2, rule: "slack-token" }]);
	});

	test("nothing to scan is no hits", () => {
		assert.deepEqual(scanDiff(""), []);
	});
});

describe("bin/brain-precommit", { skip: WSL_ONLY }, () => {
	const HOOK = join(REPO_ROOT, "bin", "brain-precommit");
	let repo: string;
	let bin: string;
	const extraDirs: string[] = [];

	const path = (b: string) => `${b}:${dirname(process.execPath)}:/usr/bin:/bin`;
	const stage = (file: string, text: string) => {
		mkdirSync(dirname(join(repo, file)), { recursive: true });
		writeFileSync(join(repo, file), text);
		git(repo, "add", file);
	};
	const runHook = (binDir: string = bin) =>
		spawnSync(HOOK, [], { cwd: repo, env: { ...GIT_ENV, PATH: path(binDir) }, encoding: "utf8", windowsHide: true, timeout: 30_000 });

	beforeEach(() => {
		repo = makeRepo("brain");
		bin = makeBin();
	});
	afterEach(() => {
		rmTemp(dirname(repo));
		rmTemp(bin);
		for (const d of extraDirs.splice(0)) rmTemp(d);
	});

	test("without gitleaks, a staged secret blocks the commit and names the rule and line, not the value", () => {
		stage("notes/a.md", `fine\n${GEMINI}\n`);
		const r = runHook();
		assert.equal(r.status, 1, r.stdout + r.stderr);
		const out = r.stdout + r.stderr;
		assert.match(out, /gemini-key/);
		assert.match(out, /notes\/a\.md:2/);
		assert.ok(!out.includes(GEMINI) && !out.includes("FAKEFAKE"));
	});

	test("a clean staged change passes", () => {
		stage("notes/a.md", "just prose\n");
		assert.equal(runHook().status, 0);
	});

	test("a secret that is only in an unstaged file does not block", () => {
		stage("notes/a.md", "clean\n");
		writeFileSync(join(repo, "notes/b.md"), `${GEMINI}\n`);
		assert.equal(runHook().status, 0);
	});

	test("with gitleaks installed it runs `gitleaks protect --staged` and trusts its verdict", () => {
		const withLeaks = makeBin({ gitleaks: { exit: 0 } });
		extraDirs.push(withLeaks);
		stage("notes/a.md", `${GEMINI}\n`);
		const r = runHook(withLeaks);
		assert.equal(r.status, 0, "gitleaks said clean; the fallback scanner should not have run");
		assert.match(
			spawnSync("cat", [join(withLeaks, "gitleaks.log")], { encoding: "utf8" }).stdout,
			/protect --staged/,
		);
	});

	test("a gitleaks hit blocks the commit", () => {
		const withLeaks = makeBin({ gitleaks: { exit: 1 } });
		extraDirs.push(withLeaks);
		stage("notes/a.md", "clean\n");
		assert.equal(runHook(withLeaks).status, 1);
	});

	test("a gitleaks that cannot run falls back to the built-in scan", () => {
		const broken = makeBin({ gitleaks: { exit: 126 } });
		extraDirs.push(broken);
		stage("notes/a.md", `${GEMINI}\n`);
		assert.equal(runHook(broken).status, 1);
		const clean = makeBin({ gitleaks: { exit: 126 } });
		extraDirs.push(clean);
		git(repo, "reset", "-q");
		stage("notes/c.md", "clean\n");
		assert.equal(runHook(clean).status, 0);
	});

	test("installed as .git/hooks/pre-commit through a symlink, it stops a real commit", () => {
		symlinkSync(HOOK, join(repo, ".git", "hooks", "pre-commit"));
		const env = { ...GIT_ENV, PATH: path(bin) };
		stage("notes/a.md", `${GITHUB}\n`);
		const bad = spawnSync("git", ["commit", "-m", "x"], { cwd: repo, env, encoding: "utf8", windowsHide: true });
		assert.notEqual(bad.status, 0);
		assert.ok(!(bad.stdout + bad.stderr).includes(GITHUB));
		git(repo, "reset", "-q");
		stage("notes/b.md", "fine\n");
		const ok = spawnSync("git", ["commit", "-m", "y"], { cwd: repo, env, encoding: "utf8", windowsHide: true });
		assert.equal(ok.status, 0, ok.stderr);
	});
});
