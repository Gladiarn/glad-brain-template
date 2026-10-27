/**
 * Tests for the two-PC sync: pull at session start, commit and push after a
 * save, and the save lock. A bare repo plus two clones stand in for the two
 * PCs; nothing touches a real remote.
 */

import { test, describe, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, readFileSync, readdirSync, symlinkSync, utimesSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { commitPush, pull, withSaveLock } from "../lib/brain/sync.ts";
import { parseHookContext } from "../lib/hook-io.ts";
import { rmTemp, runScript } from "./_helpers.ts";
import { GIT_ENV, REPO_ROOT, git, makeRepo, tempDir, WSL_ONLY } from "./_brain-helpers.ts";
import { spawnSync } from "node:child_process";

// commitPush and pull run git in this process, so it needs an identity.
for (const k of ["GIT_AUTHOR_NAME", "GIT_AUTHOR_EMAIL", "GIT_COMMITTER_NAME", "GIT_COMMITTER_EMAIL", "GIT_TERMINAL_PROMPT"]) {
	process.env[k] = GIT_ENV[k] ?? "";
}

const NEXT = (step: string) => `---
date: "2026-10-27"
quarter: Q4-2026
status: active
description: "plan"
tags:
  - work-note
---

# Next: x

## What To Do Next

1. ${step}
`;
const PLAN = "work/active/x/next.md";

describe("pull, commitPush and the two-PC flow", { skip: WSL_ONLY }, () => {
	let root: string;
	let remote: string;
	let a: string;
	let b: string;
	const at = (clone: string, rel: string) => join(clone, rel);
	const put = (clone: string, rel: string, text: string) => {
		mkdirSync(dirname(at(clone, rel)), { recursive: true });
		writeFileSync(at(clone, rel), text);
	};
	const read = (clone: string, rel: string) => readFileSync(at(clone, rel), "utf8");
	const commitIn = (clone: string, msg: string) => {
		git(clone, "add", "-A");
		git(clone, "commit", "-q", "-m", msg);
	};
	const head = (clone: string) => git(clone, "rev-parse", "HEAD").trim();
	const remoteHead = () => git(remote, "rev-parse", "main").trim();
	const remoteLog = () => git(remote, "log", "--format=%s", "main").trim().split("\n");

	beforeEach(() => {
		root = tempDir("brain-sync-");
		remote = join(root, "remote.git");
		git(root, "init", "-q", "--bare", "-b", "main", remote);
		a = join(root, "pc-a");
		git(root, "clone", "-q", remote, a);
		git(a, "checkout", "-q", "-b", "main");
		put(a, PLAN, NEXT("first"));
		put(a, "README.md", "# brain\n");
		commitIn(a, "init");
		git(a, "push", "-q", "-u", "origin", "main");
		b = join(root, "pc-b");
		git(root, "clone", "-q", remote, b);
	});
	afterEach(() => rmTemp(root));

	test("a change pushed from one PC comes in with pull on the other", () => {
		put(a, PLAN, NEXT("from A"));
		commitIn(a, "plan from A");
		git(a, "push", "-q");
		const r = pull(b);
		assert.deepEqual(r, { ok: true });
		assert.match(read(b, PLAN), /from A/);
	});

	test("nothing to pull is ok, quietly", () => {
		assert.deepEqual(pull(b), { ok: true });
	});

	test("a folder that is not a git repo, or has no remote, is ok and quiet", () => {
		assert.deepEqual(pull(tempDir("brain-nogit-")), { ok: true });
		const local = makeRepo("local");
		try {
			assert.deepEqual(pull(local), { ok: true });
		} finally {
			rmTemp(dirname(local));
		}
	});

	test("an unreachable remote gives ok:false with a warning and no exception", () => {
		git(b, "remote", "set-url", "origin", join(root, "does-not-exist.git"));
		const r = pull(b);
		assert.equal(r.ok, false);
		if (!r.ok) {
			assert.match(r.warning, /offline|reach/i);
			assert.equal(r.conflicts, undefined);
		}
	});

	test("the warning never carries a token from the remote url", () => {
		git(b, "remote", "set-url", "origin", "https://user:ghp_FAKEFAKEFAKEFAKE@127.0.0.1:1/me/brain.git");
		const r = pull(b);
		assert.equal(r.ok, false);
		assert.ok(!JSON.stringify(r).includes("ghp_FAKE"), JSON.stringify(r));
	});

	test("conflicting edits to the same note: the pull aborts, names the file, and changes nothing", () => {
		put(a, PLAN, NEXT("A's version"));
		commitIn(a, "plan A");
		git(a, "push", "-q");
		put(b, PLAN, NEXT("B's version"));
		commitIn(b, "plan B");
		const headBefore = head(b);
		const r = pull(b);
		assert.equal(r.ok, false);
		if (!r.ok) {
			assert.deepEqual(r.conflicts, [PLAN]);
			assert.match(r.warning, /conflict/i);
			assert.ok(r.warning.includes(PLAN));
		}
		assert.equal(read(b, PLAN), NEXT("B's version"));
		assert.equal(head(b), headBefore);
		assert.ok(!existsSync(join(b, ".git", "rebase-merge")) && !existsSync(join(b, ".git", "rebase-apply")), "a rebase was left half done");
		assert.equal(git(b, "status", "--porcelain").trim(), "");
	});

	test("an uncommitted edit that conflicts with the incoming change is put back exactly", () => {
		put(a, PLAN, NEXT("A's version"));
		commitIn(a, "plan A");
		git(a, "push", "-q");
		put(b, PLAN, NEXT("B's unsaved edit"));
		const headBefore = head(b);
		const r = pull(b);
		assert.equal(r.ok, false);
		if (!r.ok) assert.deepEqual(r.conflicts, [PLAN]);
		assert.equal(read(b, PLAN), NEXT("B's unsaved edit"));
		assert.equal(head(b), headBefore);
		assert.equal(git(b, "stash", "list").trim(), "", "the autostash was left behind");
		assert.ok(!read(b, PLAN).includes("<<<<<<<"), "conflict markers in the note");
	});

	test("an uncommitted edit to a different note survives a pull that brings in other changes", () => {
		put(a, "work/active/x/tasks.md", "# tasks from A\n");
		commitIn(a, "tasks A");
		git(a, "push", "-q");
		put(b, "README.md", "# brain, edited here\n");
		const r = pull(b);
		assert.deepEqual(r, { ok: true });
		assert.equal(read(b, "README.md"), "# brain, edited here\n");
		assert.equal(read(b, "work/active/x/tasks.md"), "# tasks from A\n");
	});

	test("commitPush commits with the given message, pushes, and adds no trailer", () => {
		put(a, PLAN, NEXT("saved"));
		const r = commitPush(a, "brain: save x");
		assert.deepEqual(r, { pushed: true });
		assert.equal(git(remote, "log", "-1", "--format=%B", "main").trim(), "brain: save x");
		assert.equal(remoteHead(), head(a));
	});

	test("commitPush on a clean tree makes no commit", () => {
		const before = head(a);
		const r = commitPush(a, "brain: save x");
		assert.equal(r.pushed, true);
		assert.equal(head(a), before);
	});

	test("a push that fails offline is retried by the next commitPush, and the remote ends up with both commits", () => {
		const good = git(a, "remote", "get-url", "origin").trim();
		git(a, "remote", "set-url", "origin", join(root, "gone.git"));
		put(a, PLAN, NEXT("first save, offline"));
		const first = commitPush(a, "brain: save one");
		assert.equal(first.pushed, false);
		assert.match(first.warning ?? "", /push|offline|retry/i);
		assert.equal(git(a, "log", "-1", "--format=%s").trim(), "brain: save one");

		git(a, "remote", "set-url", "origin", good);
		put(a, PLAN, NEXT("second save, online"));
		const second = commitPush(a, "brain: save two");
		assert.deepEqual(second, { pushed: true });
		assert.deepEqual(remoteLog().slice(0, 3), ["brain: save two", "brain: save one", "init"]);
	});

	test("a push rejected because the other PC pushed first pulls, rebases and pushes", () => {
		put(b, "work/active/x/tasks.md", "# tasks from B\n");
		commitIn(b, "tasks B");
		git(b, "push", "-q");
		put(a, PLAN, NEXT("A's save"));
		const r = commitPush(a, "brain: save x");
		assert.deepEqual(r, { pushed: true });
		assert.deepEqual(remoteLog().slice(0, 3), ["brain: save x", "tasks B", "init"]);
	});

	test("a push that would need a conflicting merge reports the conflict and keeps the local commit", () => {
		put(b, PLAN, NEXT("B pushed this"));
		commitIn(b, "plan B");
		git(b, "push", "-q");
		put(a, PLAN, NEXT("A's save"));
		const r = commitPush(a, "brain: save x");
		assert.equal(r.pushed, false);
		assert.match(r.warning ?? "", /conflict/i);
		assert.equal(read(a, PLAN), NEXT("A's save"));
		assert.equal(git(a, "log", "-1", "--format=%s").trim(), "brain: save x");
		assert.equal(git(a, "status", "--porcelain").trim(), "");
	});

	test("no remote: committed locally, with a warning that says why it did not push", () => {
		const local = makeRepo("local");
		try {
			put(local, PLAN, NEXT("x"));
			const r = commitPush(local, "brain: save x");
			assert.equal(r.pushed, false);
			assert.match(r.warning ?? "", /remote/i);
			assert.equal(git(local, "log", "-1", "--format=%s").trim(), "brain: save x");
		} finally {
			rmTemp(dirname(local));
		}
	});

	test("a failing pre-commit hook is reported, nothing is pushed", () => {
		const hook = join(a, ".git", "hooks", "pre-commit");
		writeFileSync(hook, "#!/bin/sh\necho 'secret guard: gemini key at line 3' >&2\nexit 1\n", { mode: 0o755 });
		put(a, PLAN, NEXT("with a secret"));
		const before = remoteHead();
		const r = commitPush(a, "brain: save x");
		assert.equal(r.pushed, false);
		assert.match(r.warning ?? "", /commit/i);
		assert.match(r.warning ?? "", /secret guard/);
		assert.equal(remoteHead(), before);
	});
});

describe("withSaveLock", { skip: WSL_ONLY }, () => {
	let vault: string;
	beforeEach(() => {
		vault = tempDir("brain-lock-");
	});
	afterEach(() => rmTemp(vault));
	const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

	test("two concurrent saves run one after the other", async () => {
		const events: string[] = [];
		const job = (name: string) => async () => {
			events.push(`${name}:start`);
			await sleep(150);
			events.push(`${name}:end`);
			return name;
		};
		const [x, y] = await Promise.all([withSaveLock(vault, job("one")), withSaveLock(vault, job("two"))]);
		assert.deepEqual([x, y].sort(), ["one", "two"]);
		const first = events[0]!.split(":")[0]!;
		const second = first === "one" ? "two" : "one";
		assert.deepEqual(events, [`${first}:start`, `${first}:end`, `${second}:start`, `${second}:end`]);
	});

	test("a save that waits longer than the limit gets busy and does not run", async () => {
		let ran = false;
		const holder = withSaveLock(vault, async () => {
			await sleep(400);
		});
		await sleep(30);
		const r = await withSaveLock(
			vault,
			async () => {
				ran = true;
			},
			{ waitMs: 100 },
		);
		assert.equal(r, "busy");
		assert.equal(ran, false);
		await holder;
	});

	test("the lock is released after the work, and after a throw", async () => {
		await withSaveLock(vault, async () => 1);
		assert.ok(!existsSync(join(vault, ".brain", "save.lock")));
		await assert.rejects(
			withSaveLock(vault, async () => {
				throw new Error("boom");
			}),
			/boom/,
		);
		assert.ok(!existsSync(join(vault, ".brain", "save.lock")));
		assert.equal(await withSaveLock(vault, async () => "again"), "again");
	});

	test("a stale lock from a crashed save is taken over", async () => {
		mkdirSync(join(vault, ".brain"), { recursive: true });
		const lock = join(vault, ".brain", "save.lock");
		writeFileSync(lock, "999999 crashed\n");
		const old = new Date(Date.now() - 11 * 60_000);
		utimesSync(lock, old, old);
		assert.equal(await withSaveLock(vault, async () => "took over", { waitMs: 200 }), "took over");
	});

	test("a fresh lock is not taken over", async () => {
		mkdirSync(join(vault, ".brain"), { recursive: true });
		writeFileSync(join(vault, ".brain", "save.lock"), "1 working\n");
		assert.equal(await withSaveLock(vault, async () => "no", { waitMs: 150 }), "busy");
		assert.ok(readdirSync(join(vault, ".brain")).includes("save.lock"));
	});
});

describe("pull wired into session start", { skip: WSL_ONLY }, () => {
	const HOOK = join(REPO_ROOT, "bin", "brain-hook");
	const SESSION_START = join(REPO_ROOT, ".claude", "scripts", "session-start.ts");
	let root: string;
	let remote: string;
	let a: string;
	let vault: string; // PC B's clone, which is where the session runs
	let repo: string;
	let home: string;
	const put = (clone: string, rel: string, text: string) => {
		mkdirSync(dirname(join(clone, rel)), { recursive: true });
		writeFileSync(join(clone, rel), text);
	};
	const commitIn = (clone: string, msg: string) => {
		git(clone, "add", "-A");
		git(clone, "commit", "-q", "-m", msg);
	};
	const mapJson = JSON.stringify({ projects: { "github.com/me/x": { project: "x", client: null } } });

	const viaHook = () => {
		const env: NodeJS.ProcessEnv = { ...GIT_ENV, HOME: home, PATH: `${dirname(process.execPath)}:/usr/bin:/bin`, CLAUDE_PROJECT_DIR: repo };
		delete env["BRAIN_VAULT"];
		const r = spawnSync(HOOK, ["session-start.ts"], {
			cwd: repo,
			env,
			input: JSON.stringify({ source: "startup", session_id: "s-1" }),
			encoding: "utf8",
			windowsHide: true,
			timeout: 60_000,
		});
		return r.stdout === "" ? "" : parseHookContext(r.stdout, "SessionStart");
	};

	beforeEach(() => {
		root = tempDir("brain-wire-");
		remote = join(root, "remote.git");
		git(root, "init", "-q", "--bare", "-b", "main", remote);
		a = join(root, "pc-a");
		git(root, "clone", "-q", remote, a);
		git(a, "checkout", "-q", "-b", "main");
		put(a, PLAN, NEXT("first"));
		put(a, "projects.map.json", mapJson);
		put(a, "vault-manifest.json", "{}\n");
		commitIn(a, "init");
		git(a, "push", "-q", "-u", "origin", "main");
		vault = join(root, "pc-b");
		git(root, "clone", "-q", remote, vault);
		// The scripts under test are the repo's own, linked in and kept out of git.
		symlinkSync(join(REPO_ROOT, ".claude"), join(vault, ".claude"));
		writeFileSync(join(vault, ".git", "info", "exclude"), ".claude\n");
		repo = makeRepo("x", "git@github.com:me/x.git");
		home = tempDir("brain-home-");
		mkdirSync(join(home, ".config", "second-brain"), { recursive: true });
		writeFileSync(join(home, ".config", "second-brain", ".env"), `BRAIN_VAULT=${vault}\n`);
	});
	afterEach(() => {
		rmTemp(root);
		rmTemp(dirname(repo));
		rmTemp(home);
	});

	test("a linked repo's session start pulls the other PC's plan first", () => {
		put(a, PLAN, NEXT("step written on the other PC"));
		commitIn(a, "plan from A");
		git(a, "push", "-q");
		const ctx = viaHook();
		assert.match(ctx, /step written on the other PC/);
		assert.ok(!/Brain sync/.test(ctx), "a clean pull should add no warning");
	});

	test("an unreachable remote warns in the context and still shows the local plan", () => {
		git(vault, "remote", "set-url", "origin", join(root, "gone.git"));
		const ctx = viaHook();
		assert.match(ctx, /Brain sync/);
		assert.match(ctx, /offline|reach/i);
		assert.match(ctx, /Plan for today: x/);
		assert.match(ctx, /1\. first/);
	});

	test("a conflict is shown with the file names, and the local plan is left as it was", () => {
		put(a, PLAN, NEXT("A's version"));
		commitIn(a, "plan A");
		git(a, "push", "-q");
		put(vault, PLAN, NEXT("B's version"));
		commitIn(vault, "plan B");
		const ctx = viaHook();
		assert.match(ctx, /Brain sync/);
		assert.match(ctx, /conflict/i);
		assert.ok(ctx.includes(PLAN));
		assert.match(ctx, /B's version/);
		assert.equal(readFileSync(join(vault, PLAN), "utf8"), NEXT("B's version"));
	});

	test("the vault's own session start pulls too", () => {
		put(a, "work/active/general/next.md", NEXT("general step from A").replace("# Next: x", "# Next: general"));
		commitIn(a, "general plan");
		git(a, "push", "-q");
		const r = runScript(SESSION_START, { source: "startup" }, { CLAUDE_PROJECT_DIR: vault, BRAIN_VAULT: vault });
		const ctx = parseHookContext(r.stdout, "SessionStart");
		assert.match(ctx, /general step from A/);
	});

	test("a compact does not pull again", () => {
		put(a, PLAN, NEXT("pushed after the start"));
		commitIn(a, "later");
		git(a, "push", "-q");
		const r = runScript(SESSION_START, { source: "compact" }, { CLAUDE_PROJECT_DIR: vault, BRAIN_VAULT: vault });
		assert.ok(!r.stdout.includes("pushed after the start"));
		assert.ok(!readFileSync(join(vault, PLAN), "utf8").includes("pushed after the start"));
	});
});
