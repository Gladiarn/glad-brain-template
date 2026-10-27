/**
 * End-to-end smoke test of the whole brain, in a temp HOME: set up a template
 * clone with a bare remote, link a fake repo, start a session from it
 * through the global launcher, save with a canned Gemini, and see a second PC
 * pick the save up at its next session start.
 */

import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, readFileSync, symlinkSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { parseHookContext } from "../lib/hook-io.ts";
import { rmTemp } from "./_helpers.ts";
import { GIT_ENV, git, makeRepo, WSL_ONLY } from "./_brain-helpers.ts";
import { FAKE_KEY, makeFakeTools, makeTemplateClone, readLog, runSetup, tempDir } from "./_brain-setup-helpers.ts";

describe("the second brain end to end", { skip: WSL_ONLY }, () => {
	let root: string;
	let remote: string;
	let tools: string;
	let pcA: { vault: string; home: string };
	let pcB: { vault: string; home: string };
	let siteA: string;
	let siteB: string;
	let sessionBytes = 0;

	const pathFor = () => `${tools}:${dirname(process.execPath)}:/usr/bin:/bin`;

	/** A command in the shell the owner would have: the env file sourced, bin/ on PATH. */
	const asOwner = (pc: { home: string }, cwd: string, script: string, env: Record<string, string> = {}) =>
		spawnSync("bash", ["-c", `set -a; . "$HOME/.config/second-brain/.env"; set +a; ${script}`], {
			cwd,
			env: { ...GIT_ENV, HOME: pc.home, PATH: pathFor(), ...env },
			encoding: "utf8",
			windowsHide: true,
			timeout: 60_000,
		});

	const sessionStart = (pc: { home: string }, repo: string) => {
		return asOwner(
			pc,
			repo,
			'printf \'{"source":"startup","session_id":"smoke-1"}\' | "$BRAIN_VAULT/bin/brain-hook" session-start.ts',
			{ CLAUDE_PROJECT_DIR: repo },
		);
	};

	before(() => {
		root = tempDir("brain-smoke-");
		remote = join(root, "remote.git");
		git(root, "init", "-q", "--bare", "-b", "main", remote);
		tools = join(root, "tools");
		makeFakeTools(tools);

		// PC A: the template clone, committed and pushed.
		const homeA = join(root, "home-a");
		mkdirSync(homeA);
		const vaultA = makeTemplateClone(join(root, "pc-a-parent"));
		git(vaultA, "remote", "add", "origin", remote);
		git(vaultA, "add", "-A");
		git(vaultA, "commit", "-q", "-m", "init");
		git(vaultA, "push", "-q", "-u", "origin", "main");
		pcA = { vault: vaultA, home: homeA };

		// PC B: a plain clone of the same brain, before anything is saved.
		const homeB = join(root, "home-b");
		mkdirSync(homeB);
		const vaultB = join(root, "pc-b", "brain");
		mkdirSync(dirname(vaultB));
		git(root, "clone", "-q", remote, vaultB);
		symlinkSync(join(vaultA, ".claude"), join(vaultB, ".claude"));
		writeFileSync(join(vaultB, ".git", "info", "exclude"), ".claude\n");
		pcB = { vault: vaultB, home: homeB };

		siteA = makeRepo("site", "git@github.com:me/site.git");
		siteB = makeRepo("site-checkout-on-pc-b", "https://github.com/me/site");
	});
	after(() => {
		rmTemp(root);
		rmTemp(dirname(siteA));
		rmTemp(dirname(siteB));
	});

	test("setup runs on both PCs", () => {
		for (const pc of [pcA, pcB]) {
			const r = runSetup({ clone: pc.vault, home: pc.home, tools });
			assert.equal(r.code, 0, r.stdout + r.stderr);
			assert.ok(!(r.stdout + r.stderr).includes(FAKE_KEY));
		}
	});

	test("brain link wires the repo without writing into it", () => {
		const r = asOwner(pcA, siteA, "brain link --client acme");
		assert.equal(r.status, 0, r.stdout + r.stderr);
		assert.match(r.stdout, /linked: site \(client: acme\)/);
		assert.equal(git(siteA, "status", "--porcelain").trim(), "");
		assert.deepEqual(readLog(tools, "graphify").filter((l) => l.startsWith("update")), [`update ${siteA}`]);
	});

	test("a session in the linked repo starts with that project's plan, through the global hook", () => {
		const r = sessionStart(pcA, siteA);
		assert.equal(r.status, 0, r.stderr);
		const ctx = parseHookContext(r.stdout, "SessionStart");
		assert.match(ctx, /Plan for today: site \(client: acme\)/);
		assert.match(ctx, /## What To Do Next/);
		assert.ok(!ctx.includes("Vault File Listing"));
		sessionBytes = Buffer.byteLength(r.stdout, "utf8");
		assert.ok(sessionBytes < 4000, `${sessionBytes} bytes`);
		console.log(`smoke: SessionStart output for a linked repo is ${sessionBytes} bytes`);
	});

	test("brain save files a summary through a canned Gemini, and the remote gets the commit", () => {
		const next = readFileSync(join(pcA.vault, "work/active/site/next.md"), "utf8");
		const updated = next.replace("## What To Do Next\n\n1.\n", "## What To Do Next\n\n1. Wire the contact form\n");
		assert.notEqual(updated, next, "the template's What To Do Next section changed shape");

		const fixtures = join(root, "fixtures");
		mkdirSync(fixtures);
		writeFileSync(join(fixtures, "01.json"), JSON.stringify({ json: { files: [{ path: "work/active/site/next.md", content: updated }] } }));
		writeFileSync(join(fixtures, "02.json"), JSON.stringify({ json: { ok: true, problems: [] } }));
		const summary = join(root, "summary.json");
		writeFileSync(
			summary,
			JSON.stringify({ project: "site", kind: "session", done: ["Linked the repo"], next: ["Wire the contact form"] }),
		);

		const run = asOwner(pcA, siteA, `brain save --summary ${JSON.stringify(summary)}`, { NODE_ENV: "test", BRAIN_GEMINI_FAKE: fixtures });
		assert.equal(run.status, 0, run.stdout + run.stderr);
		assert.match(run.stdout, /saved via Gemini/);
		assert.ok(!(run.stdout + run.stderr).includes(FAKE_KEY));
		assert.equal(git(remote, "log", "-1", "--format=%s", "main").trim(), "brain: save site");
		assert.match(git(remote, "show", "main:work/active/site/next.md"), /Wire the contact form/);
		assert.match(git(remote, "show", "main:projects.map.json"), /github\.com\/me\/site/);
	});

	test("the second PC pulls the save at its next session start", () => {
		const before = readFileSync(join(pcB.vault, "projects.map.json"), "utf8");
		assert.ok(!before.includes("github.com/me/site"), "PC B already had the link");
		const r = sessionStart(pcB, siteB);
		assert.equal(r.status, 0, r.stderr);
		const ctx = parseHookContext(r.stdout, "SessionStart");
		assert.match(ctx, /Plan for today: site/);
		assert.match(ctx, /1\. Wire the contact form/);
		assert.ok(!/Brain sync/.test(ctx), ctx);
	});

	test("the keys never reached either remote", () => {
		const all = git(remote, "log", "--all", "-p");
		assert.ok(!all.includes(FAKE_KEY));
	});
});
