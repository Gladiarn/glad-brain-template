/**
 * Tests for `brain save`: the exit codes Claude follows (0 saved, 3 fall
 * back, 1 bad input), the wrong-project guard, and the canned-Gemini path the
 * smoke test uses (BRAIN_GEMINI_FAKE, honoured only under NODE_ENV=test).
 */

import { test, describe, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { rmTemp } from "./_helpers.ts";
import { git, makeBin, makeRepo, makeVault, runBrain, tempDir, WSL_ONLY } from "./_brain-helpers.ts";

const KEY = "AIzaFAKEFAKEFAKEFAKEFAKEFAKEFAKEFAKEFAKE";

const NEXT_OLD = `---
date: "2026-10-26"
quarter: Q4-2026
status: active
description: "plan"
tags:
  - work-note
---

# Next: site

## What To Do Next

1. Build the header
`;
const NEXT_NEW = NEXT_OLD.replace("1. Build the header", "1. Wire the contact form");

const SUMMARY = {
	project: "site",
	kind: "session",
	done: ["Built the header"],
	addedTasks: [],
	decisions: [],
	lessons: [],
	next: ["Wire the contact form"],
	blocked: [],
};

describe("brain save", { skip: WSL_ONLY }, () => {
	let vault: string;
	let repo: string;
	let bin: string;
	let scratch: string;
	const summaryFile = (obj: unknown) => {
		const f = join(scratch, "summary.json");
		writeFileSync(f, typeof obj === "string" ? obj : JSON.stringify(obj));
		return f;
	};
	const save = (args: string[], env: Record<string, string> = {}, cwd = repo) =>
		runBrain(["save", ...args], { vault, cwd, binDir: bin, env: { NODE_ENV: "test", ...env } });
	const fixtures = (steps: unknown[]) => {
		const dir = join(scratch, "fixtures");
		mkdirSync(dir, { recursive: true });
		steps.forEach((s, i) => writeFileSync(join(dir, `${String(i + 1).padStart(2, "0")}.json`), JSON.stringify(s)));
		return dir;
	};
	const nextOnDisk = () => readFileSync(join(vault, "work/active/site/next.md"), "utf8");

	beforeEach(() => {
		vault = makeVault();
		repo = makeRepo("site", "git@github.com:me/site.git");
		bin = makeBin();
		scratch = tempDir("brain-scratch-");
		writeFileSync(
			join(vault, "projects.map.json"),
			JSON.stringify({ projects: { "github.com/me/site": { project: "site", client: null } } }),
		);
		mkdirSync(join(vault, "work/active/site"), { recursive: true });
		writeFileSync(join(vault, "work/active/site/next.md"), NEXT_OLD);
	});
	afterEach(() => {
		rmTemp(vault);
		rmTemp(repo);
		rmTemp(bin);
		rmTemp(scratch);
	});

	test("saved by Gemini: exit 0 and the files named", () => {
		const dir = fixtures([
			{ json: { files: [{ path: "work/active/site/next.md", content: NEXT_NEW }] }, prompt: 10, output: 5 },
			{ json: { ok: true, problems: [] } },
		]);
		const r = save(["--summary", summaryFile(SUMMARY)], { GEMINI_API_KEY: KEY, BRAIN_GEMINI_FAKE: dir });
		assert.equal(r.code, 0, r.stdout + r.stderr);
		assert.match(r.stdout, /saved via Gemini/);
		assert.match(r.stdout, /work\/active\/site\/next\.md/);
		assert.equal(nextOnDisk(), NEXT_NEW);
		assert.ok(!r.stdout.includes(KEY) && !r.stderr.includes(KEY));
	});

	test("fallback: exit 3, the reason and the exact files on stdout, nothing written", () => {
		const r = save(["--summary", summaryFile(SUMMARY)], { GEMINI_API_KEY: "" });
		assert.equal(r.code, 3, r.stdout + r.stderr);
		assert.match(r.stdout, /no Gemini key/);
		assert.match(r.stdout, /work\/active\/site\/next\.md/);
		assert.match(r.stdout, /brain\/Gotchas\.md/);
		assert.equal(nextOnDisk(), NEXT_OLD);
	});

	test("a Gemini rate limit is a fallback, exit 3", () => {
		const dir = fixtures([{ status: 429 }]);
		const r = save(["--summary", summaryFile(SUMMARY)], { GEMINI_API_KEY: KEY, BRAIN_GEMINI_FAKE: dir });
		assert.equal(r.code, 3);
		assert.match(r.stdout, /429|rate limit/i);
		assert.ok(!r.stdout.includes(KEY) && !r.stderr.includes(KEY));
	});

	test("an invalid summary is exit 1 with the reason", () => {
		const r = save(["--summary", summaryFile({ ...SUMMARY, kind: "weekly" })], { GEMINI_API_KEY: KEY });
		assert.equal(r.code, 1);
		assert.match(r.stderr, /kind/);
	});

	test("a summary that is not JSON, or a missing file, or no --summary, is exit 1", () => {
		assert.equal(save(["--summary", summaryFile("{ nope")], { GEMINI_API_KEY: KEY }).code, 1);
		assert.equal(save(["--summary", join(scratch, "absent.json")], { GEMINI_API_KEY: KEY }).code, 1);
		const none = save([], { GEMINI_API_KEY: KEY });
		assert.equal(none.code, 1);
		assert.match(none.stderr, /--summary/);
	});

	test("a summary for another project than the folder's is refused, nothing written", () => {
		const r = save(["--summary", summaryFile({ ...SUMMARY, project: "other" })], { GEMINI_API_KEY: KEY });
		assert.equal(r.code, 1);
		assert.match(r.stderr, /other/);
		assert.match(r.stderr, /site/);
		assert.equal(nextOnDisk(), NEXT_OLD);
	});

	test("a folder that is not linked is refused with a pointer to brain link", () => {
		const stranger = makeRepo("stranger", "git@github.com:me/stranger.git");
		try {
			const r = save(["--summary", summaryFile(SUMMARY)], { GEMINI_API_KEY: KEY }, stranger);
			assert.equal(r.code, 1);
			assert.match(r.stderr, /brain link/);
		} finally {
			rmTemp(stranger);
		}
	});

	test("run from inside the vault, the project is general", () => {
		mkdirSync(join(vault, "work/active/general"), { recursive: true });
		const r = save(["--summary", summaryFile({ ...SUMMARY, project: "general" })], { GEMINI_API_KEY: "" }, vault);
		assert.equal(r.code, 3);
		assert.match(r.stdout, /work\/active\/general\/next\.md/);
	});

	test("the canned Gemini is ignored outside NODE_ENV=test: with no key it is still a plain fallback", () => {
		const dir = fixtures([{ json: { files: [{ path: "work/active/site/next.md", content: NEXT_NEW }] } }, { json: { ok: true, problems: [] } }]);
		const r = save(["--summary", summaryFile(SUMMARY)], { NODE_ENV: "production", GEMINI_API_KEY: "", BRAIN_GEMINI_FAKE: dir });
		assert.equal(r.code, 3);
		assert.equal(nextOnDisk(), NEXT_OLD);
	});
});

describe("brain save: commit, push, lock", { skip: WSL_ONLY }, () => {
	let root: string;
	let remote: string;
	let vault: string;
	let repo: string;
	let bin: string;
	let scratch: string;
	const gitIn = (cwd: string, ...args: string[]) => git(cwd, ...args);
	const save = (args: string[], env: Record<string, string> = {}) =>
		runBrain(["save", ...args], { vault, cwd: repo, binDir: bin, env: { NODE_ENV: "test", ...env } });
	const summaryFile = () => {
		const f = join(scratch, "summary.json");
		writeFileSync(f, JSON.stringify(SUMMARY));
		return f;
	};
	const fixtures = () => {
		const dir = join(scratch, "fixtures");
		mkdirSync(dir, { recursive: true });
		writeFileSync(join(dir, "01.json"), JSON.stringify({ json: { files: [{ path: "work/active/site/next.md", content: NEXT_NEW }] } }));
		writeFileSync(join(dir, "02.json"), JSON.stringify({ json: { ok: true, problems: [] } }));
		return dir;
	};
	const remoteLog = () => gitIn(remote, "log", "--format=%s", "main").trim().split("\n");

	beforeEach(() => {
		root = tempDir("brain-cli-git-");
		remote = join(root, "remote.git");
		gitIn(root, "init", "-q", "--bare", "-b", "main", remote);
		vault = join(root, "vault");
		gitIn(root, "clone", "-q", remote, vault);
		gitIn(vault, "checkout", "-q", "-b", "main");
		mkdirSync(join(vault, "work/active/site"), { recursive: true });
		writeFileSync(join(vault, "work/active/site/next.md"), NEXT_OLD);
		writeFileSync(join(vault, "work/Index.md"), "# Work Notes\n");
		writeFileSync(join(vault, ".gitignore"), ".brain/\n");
		writeFileSync(
			join(vault, "projects.map.json"),
			JSON.stringify({ projects: { "github.com/me/site": { project: "site", client: null } } }),
		);
		gitIn(vault, "add", "-A");
		gitIn(vault, "commit", "-q", "-m", "init");
		gitIn(vault, "push", "-q", "-u", "origin", "main");
		repo = makeRepo("site", "git@github.com:me/site.git");
		bin = makeBin();
		scratch = tempDir("brain-scratch-");
	});
	afterEach(() => {
		rmTemp(root);
		rmTemp(dirname(repo));
		rmTemp(bin);
		rmTemp(scratch);
	});

	test("a Gemini save is committed and pushed with the conventional save message", () => {
		const r = save(["--summary", summaryFile()], { GEMINI_API_KEY: KEY, BRAIN_GEMINI_FAKE: fixtures() });
		assert.equal(r.code, 0, r.stdout + r.stderr);
		assert.deepEqual(remoteLog().slice(0, 2), ["brain: save site", "init"]);
		assert.ok(!/warning/i.test(r.stdout), r.stdout);
	});

	test("a saved project gets a last-save marker, for the unsaved-session reminder", () => {
		save(["--summary", summaryFile()], { GEMINI_API_KEY: KEY, BRAIN_GEMINI_FAKE: fixtures() });
		assert.ok(existsSync(join(vault, ".brain/last-save/site")));
	});

	test("a fallback leaves no marker, and --commit-only after Claude's save adds it", () => {
		save(["--summary", summaryFile()], { GEMINI_API_KEY: "" });
		assert.ok(!existsSync(join(vault, ".brain/last-save/site")));
		writeFileSync(join(vault, "work/active/site/next.md"), NEXT_NEW);
		save(["--commit-only"]);
		assert.ok(existsSync(join(vault, ".brain/last-save/site")));
	});

	test("--commit-only commits and pushes a save Claude filed by hand", () => {
		writeFileSync(join(vault, "work/active/site/next.md"), NEXT_NEW);
		const r = save(["--commit-only"]);
		assert.equal(r.code, 0, r.stdout + r.stderr);
		assert.match(r.stdout, /committed and pushed/i);
		assert.deepEqual(remoteLog().slice(0, 2), ["brain: save site", "init"]);
	});

	test("--commit-only with a failing push still exits 0 and says it will retry", () => {
		gitIn(vault, "remote", "set-url", "origin", join(root, "gone.git"));
		writeFileSync(join(vault, "work/active/site/next.md"), NEXT_NEW);
		const r = save(["--commit-only"]);
		assert.equal(r.code, 0, r.stdout + r.stderr);
		assert.match(r.stdout, /warning/i);
		assert.match(r.stdout, /retry|next save/i);
	});

	test("--commit-only for a folder that is not linked is refused", () => {
		const stranger = makeRepo("stranger", "git@github.com:me/stranger.git");
		try {
			const r = runBrain(["save", "--commit-only"], { vault, cwd: stranger, binDir: bin, env: { NODE_ENV: "test" } });
			assert.equal(r.code, 1);
			assert.match(r.stderr, /brain link/);
		} finally {
			rmTemp(dirname(stranger));
		}
	});

	test("while another save holds the lock, save reports busy with exit 4 and writes nothing", () => {
		mkdirSync(join(vault, ".brain"), { recursive: true });
		writeFileSync(join(vault, ".brain/save.lock"), "1 working\n");
		const r = save(["--summary", summaryFile()], { GEMINI_API_KEY: KEY, BRAIN_GEMINI_FAKE: fixtures(), BRAIN_SAVE_WAIT_MS: "200" });
		assert.equal(r.code, 4, r.stdout + r.stderr);
		assert.match(r.stdout, /save busy/i);
		assert.equal(readFileSync(join(vault, "work/active/site/next.md"), "utf8"), NEXT_OLD);
	});

	test("--commit-only is behind the same lock", () => {
		mkdirSync(join(vault, ".brain"), { recursive: true });
		writeFileSync(join(vault, ".brain/save.lock"), "1 working\n");
		const r = save(["--commit-only"], { BRAIN_SAVE_WAIT_MS: "200" });
		assert.equal(r.code, 4);
	});

	test("the lock is gone after a save", () => {
		save(["--summary", summaryFile()], { GEMINI_API_KEY: "" });
		assert.ok(!existsSync(join(vault, ".brain/save.lock")));
	});
});

describe("brain sync", { skip: WSL_ONLY }, () => {
	let root: string;
	let remote: string;
	let a: string;
	let b: string;
	let bin: string;
	const sync = (cwd: string) => runBrain(["sync"], { vault: b, cwd, binDir: bin });

	beforeEach(() => {
		root = tempDir("brain-cli-sync-");
		remote = join(root, "remote.git");
		git(root, "init", "-q", "--bare", "-b", "main", remote);
		a = join(root, "a");
		git(root, "clone", "-q", remote, a);
		git(a, "checkout", "-q", "-b", "main");
		writeFileSync(join(a, "note.md"), "one\n");
		git(a, "add", "-A");
		git(a, "commit", "-q", "-m", "init");
		git(a, "push", "-q", "-u", "origin", "main");
		b = join(root, "b");
		git(root, "clone", "-q", remote, b);
		bin = makeBin();
	});
	afterEach(() => {
		rmTemp(root);
		rmTemp(bin);
	});

	test("pulls what the other PC pushed and pushes what is only local", () => {
		writeFileSync(join(a, "from-a.md"), "a\n");
		git(a, "add", "-A");
		git(a, "commit", "-q", "-m", "from a");
		git(a, "push", "-q");
		writeFileSync(join(b, "from-b.md"), "b\n");
		const r = sync(b);
		assert.equal(r.code, 0, r.stdout + r.stderr);
		assert.ok(existsSync(join(b, "from-a.md")));
		const log = git(remote, "log", "--format=%s", "main").trim().split("\n");
		assert.deepEqual(log.slice(0, 3), ["brain: sync", "from a", "init"]);
	});

	test("a conflict is reported with exit 1 and nothing is overwritten", () => {
		writeFileSync(join(a, "note.md"), "A\n");
		git(a, "commit", "-aq", "-m", "A");
		git(a, "push", "-q");
		writeFileSync(join(b, "note.md"), "B\n");
		git(b, "commit", "-aq", "-m", "B");
		const r = sync(b);
		assert.equal(r.code, 1);
		assert.match(r.stdout + r.stderr, /conflict/i);
		assert.equal(readFileSync(join(b, "note.md"), "utf8"), "B\n");
	});
});
