/**
 * Tests for the template guard: the public template repo may only change
 * infrastructure paths, so none of the owner's notes can reach it. The check
 * runs only where a `.template-repo` marker exists; the private brain deletes
 * the marker and is untouched.
 */

import { test, describe, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { checkTemplatePaths, parseTemplatePaths } from "../../../.github/scripts/template-guard.ts";
import { rmTemp } from "./_helpers.ts";
import { GIT_ENV, REPO_ROOT, git, makeRepo } from "./_brain-helpers.ts";

const GUARD = join(REPO_ROOT, ".github", "scripts", "template-guard.ts");
const globs = parseTemplatePaths(readFileSync(join(REPO_ROOT, ".template-paths"), "utf8"));

describe("checkTemplatePaths", () => {
	test("a project note is offending", () => {
		assert.deepEqual(checkTemplatePaths(["work/active/acme/next.md"], globs), ["work/active/acme/next.md"]);
	});

	test("infrastructure paths pass", () => {
		const ok = [
			".claude/scripts/brain.ts",
			"templates/Session.md",
			"bin/brain",
			"setup.sh",
			"docs/brain-setup.md",
			"README.md",
			"vault-manifest.json",
			".github/workflows/template-guard.yml",
			"work/active/general/next.md",
			"clients/Clients.md",
		];
		assert.deepEqual(checkTemplatePaths(ok, globs), []);
	});

	test("other people's data folders are offending", () => {
		const bad = [
			"clients/acme.md",
			"clients/contacts/Sarah Chen.md",
			"work/active/site/tasks.md",
			"work/archive/2026/x.md",
			"work/incidents/outage.md",
			"portfolio/wins/Q1 2026.md",
			"memories/2026/10/x.md",
			"thinking/idea.md",
			"projects.map.json.bak",
			"brain/Gotchas - Tooling.md",
			".brain/save-log.jsonl",
			"graphify-out/graph.json",
		];
		assert.deepEqual(checkTemplatePaths(bad, globs), bad);
	});

	test("it returns only the offenders, in order", () => {
		assert.deepEqual(checkTemplatePaths(["README.md", "work/active/a/next.md", "bin/brain", "clients/x.md"], globs), [
			"work/active/a/next.md",
			"clients/x.md",
		]);
	});

	test("the glob grammar: ** crosses folders, * does not, comments and blanks are ignored", () => {
		const g = parseTemplatePaths("# comment\n\ndocs/**\n*.md\n  bin/*  \n");
		assert.deepEqual(g, ["docs/**", "*.md", "bin/*"]);
		assert.deepEqual(checkTemplatePaths(["docs/a/b/c.md", "x.md", "bin/brain", "bin/sub/x", "sub/x.md"], g), ["bin/sub/x", "sub/x.md"]);
	});

	test("Windows separators are normalised", () => {
		assert.deepEqual(checkTemplatePaths(["clients\\acme.md", "bin\\brain"], globs), ["clients\\acme.md"]);
	});

	test("an empty allowlist rejects everything", () => {
		assert.deepEqual(checkTemplatePaths(["a.md"], []), ["a.md"]);
	});
});

describe("the repo's own files", () => {
	test("every file in this repo passes its own allowlist", () => {
		if (!existsSync(join(REPO_ROOT, ".git"))) return;
		const r = spawnSync("git", ["ls-files", "--cached", "--others", "--exclude-standard"], { cwd: REPO_ROOT, encoding: "utf8", windowsHide: true });
		assert.equal(r.status, 0);
		const files = r.stdout.split("\n").filter((l) => l !== "");
		assert.ok(files.length > 100);
		assert.deepEqual(checkTemplatePaths(files, globs), []);
	});

	test("the template marker exists", () => {
		assert.ok(existsSync(join(REPO_ROOT, ".template-repo")));
	});
});

describe("template-guard.ts as CI runs it", () => {
	let repo: string;
	const run = (...args: string[]) =>
		spawnSync(process.execPath, ["--disable-warning=ExperimentalWarning", "--experimental-strip-types", GUARD, ...args], {
			cwd: repo,
			env: { ...GIT_ENV },
			encoding: "utf8",
			windowsHide: true,
			timeout: 30_000,
		});
	const commit = (msg: string) => {
		git(repo, "add", "-A");
		git(repo, "commit", "-q", "-m", msg);
		return git(repo, "rev-parse", "HEAD").trim();
	};

	beforeEach(() => {
		repo = makeRepo("tpl");
		writeFileSync(join(repo, ".template-paths"), "README.md\nbin/**\n");
		writeFileSync(join(repo, "README.md"), "# tpl\n");
		writeFileSync(join(repo, ".template-repo"), "");
	});
	afterEach(() => rmTemp(dirname(repo)));

	test("a change that stays inside the allowlist passes", () => {
		const base = commit("base");
		mkdirSync(join(repo, "bin"));
		writeFileSync(join(repo, "bin", "x"), "x");
		const head = commit("infra");
		assert.equal(run(base, head).status, 0);
	});

	test("a change that touches a note fails and names the path", () => {
		const base = commit("base");
		mkdirSync(join(repo, "work/active/acme"), { recursive: true });
		writeFileSync(join(repo, "work/active/acme/next.md"), "private");
		const head = commit("oops");
		const r = run(base, head);
		assert.equal(r.status, 1);
		assert.match(r.stdout + r.stderr, /work\/active\/acme\/next\.md/);
	});

	test("deleting an offending file is fine", () => {
		mkdirSync(join(repo, "work"), { recursive: true });
		writeFileSync(join(repo, "work", "leak.md"), "private");
		const base = commit("base with a leak");
		git(repo, "rm", "-q", "work/leak.md");
		const head = commit("remove the leak");
		assert.equal(run(base, head).status, 0);
	});

	test("with no .template-repo marker the guard does nothing, even for a note", () => {
		const base = commit("base");
		rmTemp(join(repo, ".template-repo"));
		mkdirSync(join(repo, "work"), { recursive: true });
		writeFileSync(join(repo, "work", "mine.md"), "private");
		const head = commit("brain commit");
		assert.equal(run(base, head).status, 0);
	});

	test("a first push (all-zero base) is checked against the whole tree", () => {
		mkdirSync(join(repo, "work"), { recursive: true });
		writeFileSync(join(repo, "work", "mine.md"), "private");
		const head = commit("first");
		const r = run("0".repeat(40), head);
		assert.equal(r.status, 1);
		assert.match(r.stdout + r.stderr, /work\/mine\.md/);
	});

	test("missing arguments is a usage error, not a pass", () => {
		const r = run();
		assert.equal(r.status, 2);
		assert.match(r.stderr, /usage/i);
	});
});

describe("the workflow", () => {
	const yml = existsSync(join(REPO_ROOT, ".github/workflows/template-guard.yml"))
		? readFileSync(join(REPO_ROOT, ".github/workflows/template-guard.yml"), "utf8")
		: "";

	test("runs on push and pull requests, only where the marker exists, through the script", () => {
		assert.match(yml, /^\s*push:/m);
		assert.match(yml, /^\s*pull_request:/m);
		assert.match(yml, /\.template-repo/);
		assert.match(yml, /template-guard\.ts/);
		assert.match(yml, /fetch-depth: 0/);
	});
});
