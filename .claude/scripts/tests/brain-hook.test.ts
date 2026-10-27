/**
 * Tests for the global launcher, bin/brain-hook: it must stay silent inside
 * the vault (the vault's own settings already fire there), stay silent in an
 * unlinked repo, inject the right project's plan in a linked one, and never
 * block a session whatever is wrong with the install.
 */

import { test, describe, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { chmodSync, existsSync, mkdirSync, symlinkSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { rmTemp, hookContext } from "./_helpers.ts";
import { GIT_ENV, REPO_ROOT, makeRepo, makeVault, tempDir, WSL_ONLY } from "./_brain-helpers.ts";

const HOOK = join(REPO_ROOT, "bin", "brain-hook");
const FAKE_KEY = "AIzaFAKEFAKEFAKEFAKEFAKEFAKEFAKEFAKEFAKE";

const NEXT = (marker: string) => `---
date: "2026-10-27"
quarter: Q4-2026
status: active
description: "plan"
tags:
  - work-note
---

# Next

## What To Do Next

1. ${marker}
`;

describe("bin/brain-hook", { skip: WSL_ONLY }, () => {
	let vault: string;
	let home: string;
	let repo: string;
	const extra: string[] = [];

	/** Run `brain-hook <script>` as Claude Code would: project dir in the env, JSON payload on stdin. */
	const run = (
		script: string,
		opts: { projectDir?: string | null; vaultEnv?: string | null; stdin?: string; cwd?: string } = {},
	) => {
		const env: NodeJS.ProcessEnv = {
			...GIT_ENV,
			HOME: home,
			PATH: `${dirname(process.execPath)}:/usr/bin:/bin`,
		};
		delete env["BRAIN_VAULT"];
		delete env["CLAUDE_PROJECT_DIR"];
		if (opts.vaultEnv !== undefined && opts.vaultEnv !== null) env["BRAIN_VAULT"] = opts.vaultEnv;
		const projectDir = opts.projectDir === undefined ? repo : opts.projectDir;
		if (projectDir !== null) env["CLAUDE_PROJECT_DIR"] = projectDir;
		const r = spawnSync(HOOK, [script], {
			cwd: opts.cwd ?? projectDir ?? home,
			env,
			input: opts.stdin ?? JSON.stringify({ source: "startup", session_id: "s-1" }),
			encoding: "utf8",
			windowsHide: true,
			timeout: 60_000,
		});
		return { stdout: r.stdout, stderr: r.stderr, code: r.status ?? -1 };
	};

	const writeEnvFile = (vaultPath: string) => {
		mkdirSync(join(home, ".config", "second-brain"), { recursive: true });
		const f = join(home, ".config", "second-brain", ".env");
		writeFileSync(f, `BRAIN_VAULT=${vaultPath}\nGEMINI_API_KEY=${FAKE_KEY}\n`);
		chmodSync(f, 0o600);
	};

	beforeEach(() => {
		vault = makeVault();
		// The vault's scripts are the repo's: a link keeps one copy under test.
		symlinkSync(join(REPO_ROOT, ".claude"), join(vault, ".claude"));
		writeFileSync(join(vault, "vault-manifest.json"), "{}\n");
		home = tempDir("brain-home-");
		repo = makeRepo("site", "git@github.com:me/site.git");
		writeFileSync(
			join(vault, "projects.map.json"),
			JSON.stringify({ projects: { "github.com/me/site": { project: "site", client: "acme" } } }),
		);
		for (const [name, marker] of [
			["site", "Ship the contact form"],
			["other", "SECRET other-project step"],
		] as const) {
			mkdirSync(join(vault, "work", "active", name), { recursive: true });
			writeFileSync(join(vault, "work", "active", name, "next.md"), NEXT(marker));
		}
		writeEnvFile(vault);
	});
	afterEach(() => {
		rmTemp(vault);
		rmTemp(home);
		rmTemp(dirname(repo));
		for (const d of extra.splice(0)) rmTemp(d);
	});

	test("is executable", () => {
		assert.ok(existsSync(HOOK), "bin/brain-hook is missing");
	});

	test("inside the vault it prints nothing and exits 0 (the vault's own hooks fire there)", () => {
		const r = run("session-start.ts", { projectDir: vault });
		assert.equal(r.code, 0, r.stderr);
		assert.equal(r.stdout, "");
		assert.equal(r.stderr, "");
	});

	test("inside a vault subfolder it is still silent", () => {
		const r = run("session-start.ts", { projectDir: join(vault, "work", "active", "site") });
		assert.equal(r.code, 0, r.stderr);
		assert.equal(r.stdout, "");
	});

	test("an unlinked repo gets nothing and exit 0", () => {
		const stranger = makeRepo("stranger", "git@github.com:me/stranger.git");
		extra.push(dirname(stranger));
		const r = run("session-start.ts", { projectDir: stranger });
		assert.equal(r.code, 0, r.stderr);
		assert.equal(r.stdout, "");
		assert.equal(r.stderr, "");
	});

	test("a linked repo gets its own plan and no other project's", () => {
		const r = run("session-start.ts");
		assert.equal(r.code, 0, r.stderr);
		const ctx = hookContext(r.stdout);
		assert.match(ctx, /Plan for today: site/);
		assert.match(ctx, /## What To Do Next/);
		assert.match(ctx, /Ship the contact form/);
		assert.ok(!ctx.includes("SECRET"), "another project's plan leaked");
		assert.ok(!ctx.includes("Vault File Listing"), "a vault-wide listing leaked into a code repo session");
	});

	test("a subfolder of a linked repo gets the same plan", () => {
		const sub = join(repo, "src");
		mkdirSync(sub);
		const r = run("session-start.ts", { projectDir: sub });
		assert.match(hookContext(r.stdout), /Ship the contact form/);
	});

	test("with no CLAUDE_PROJECT_DIR the working directory decides", () => {
		const r = run("session-start.ts", { projectDir: null, cwd: repo });
		assert.match(hookContext(r.stdout), /Ship the contact form/);
	});

	test("BRAIN_VAULT in the environment wins over the env file", () => {
		const elsewhere = tempDir("brain-empty-");
		extra.push(elsewhere);
		writeEnvFile(elsewhere);
		const r = run("session-start.ts", { vaultEnv: vault });
		assert.match(hookContext(r.stdout), /Ship the contact form/);
	});

	test("no env file and no BRAIN_VAULT: one warning line, nothing on stdout, exit 0", () => {
		rmTemp(join(home, ".config"));
		const r = run("session-start.ts");
		assert.equal(r.code, 0);
		assert.equal(r.stdout, "");
		assert.equal(r.stderr.trim().split("\n").length, 1, r.stderr);
		assert.match(r.stderr, /BRAIN_VAULT/);
	});

	test("BRAIN_VAULT pointing at a missing folder: one warning line, exit 0", () => {
		writeEnvFile(join(home, "no-such-vault"));
		const r = run("session-start.ts");
		assert.equal(r.code, 0);
		assert.equal(r.stdout, "");
		assert.equal(r.stderr.trim().split("\n").length, 1, r.stderr);
		assert.match(r.stderr, /not found/i);
	});

	test("a script name that tries to leave the scripts folder is refused with exit 0", () => {
		for (const bad of ["../../../etc/passwd", "a/b.ts", "..", "", "x.sh"]) {
			const r = run(bad);
			assert.equal(r.code, 0, `${bad}: ${r.stderr}`);
			assert.equal(r.stdout, "", bad);
		}
	});

	test("scripts that only make sense in the vault stay silent in a linked repo", () => {
		for (const s of ["stop-checklist.ts", "validate-write.ts", "pre-compact.ts"]) {
			const r = run(s, { stdin: JSON.stringify({ session_id: "s-1" }) });
			assert.equal(r.code, 0, `${s}: ${r.stderr}`);
			assert.equal(r.stdout, "", s);
		}
	});

	test("the key in the env file never reaches stdout or stderr", () => {
		for (const s of ["session-start.ts", "classify-message.ts"]) {
			const r = run(s);
			assert.ok(!r.stdout.includes(FAKE_KEY) && !r.stderr.includes(FAKE_KEY), s);
		}
	});

	test("a script that crashes still lets the session start (exit 0)", () => {
		writeFileSync(join(vault, "projects.map.json"), "{}");
		const r = run("session-start.ts", { stdin: "not json at all" });
		assert.equal(r.code, 0);
	});
});
