/**
 * Tests for the plan-for-today injection: what a project's next.md and open
 * tasks become in a session's first context, and how an oversized plan is cut.
 */

import { test, describe, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { cutLine } from "../lib/hook-io.ts";
import { TODAY_LIMIT, todayContext } from "../lib/brain/today.ts";
import type { ResolvedProject } from "../lib/brain/project.ts";
import { hookContext, rmTemp, runScript } from "./_helpers.ts";
import { REPO_ROOT, makeVault, WSL_ONLY } from "./_brain-helpers.ts";

const SESSION_START = join(REPO_ROOT, ".claude", "scripts", "session-start.ts");

const NEXT = `---
date: "2026-10-27"
quarter: Q4-2026
status: active
description: "plan"
tags:
  - work-note
---

%%
Rewritten in place, never appended to.
%%

# Next: Site

## What To Do Next

1. Wire the contact form to the API

## Blocked

- Waiting on brand assets
`;

const TASKS = `---
date: "2026-10-27"
tags:
  - work-note
---

# Tasks: Site

## Open

- [ ] Fix the nav on mobile
- [ ]
- [ ] Add alt text to the hero

## Done

- [x] Set up hosting
`;

describe("todayContext", { skip: WSL_ONLY }, () => {
	let vault: string;
	const projectOf = (name: string, client: string | null = null): ResolvedProject => ({
		name,
		dir: join(vault, "work", "active", name),
		client,
		source: "remote",
	});
	const write = (name: string, file: string, text: string) => {
		mkdirSync(join(vault, "work", "active", name), { recursive: true });
		writeFileSync(join(vault, "work", "active", name, file), text);
	};

	beforeEach(() => {
		vault = makeVault();
	});
	afterEach(() => rmTemp(vault));

	test("carries the plan body and the open tasks, without frontmatter or the template comment", () => {
		write("site", "next.md", NEXT);
		write("site", "tasks.md", TASKS);
		const out = todayContext(vault, projectOf("site", "acme"));
		assert.match(out, /Plan for today: site/);
		assert.match(out, /client: acme/);
		assert.match(out, /^## What To Do Next$/m);
		assert.match(out, /Wire the contact form to the API/);
		assert.match(out, /Waiting on brand assets/);
		assert.match(out, /- \[ \] Fix the nav on mobile/);
		assert.match(out, /- \[ \] Add alt text to the hero/);
		assert.ok(!out.includes("quarter: Q4-2026"), "frontmatter leaked");
		assert.ok(!out.includes("Rewritten in place"), "the %% comment leaked");
		assert.ok(!out.includes("Set up hosting"), "a done task leaked");
		assert.ok(!/^- \[ \]\s*$/m.test(out), "an empty task placeholder leaked");
	});

	test("another project's plan never appears", () => {
		write("site", "next.md", NEXT);
		write("other", "next.md", NEXT.replace("Wire the contact form", "SECRET other-project step"));
		write("other", "tasks.md", TASKS.replace("Fix the nav", "SECRET other task"));
		const out = todayContext(vault, projectOf("site"));
		assert.ok(!out.includes("SECRET"), out);
	});

	test("a project with no next.md says where the plan should be", () => {
		const out = todayContext(vault, projectOf("fresh"));
		assert.match(out, /Plan for today: fresh/);
		assert.match(out, /work\/active\/fresh\/next\.md/);
		assert.match(out, /no plan yet/i);
	});

	test("a plan with no tasks.md still shows", () => {
		write("site", "next.md", NEXT);
		const out = todayContext(vault, projectOf("site"));
		assert.match(out, /Wire the contact form/);
		assert.ok(!/Open tasks/.test(out));
	});

	test("a plan over the budget is cut with the cut marker, keeping the head", () => {
		const long = NEXT + "\n## Key Context\n\n" + "A long line of context that goes on and on.\n".repeat(400);
		write("site", "next.md", long);
		write("site", "tasks.md", TASKS);
		const out = todayContext(vault, projectOf("site"));
		assert.ok(Buffer.byteLength(out, "utf8") <= TODAY_LIMIT.max, `${Buffer.byteLength(out, "utf8")} bytes`);
		assert.ok(out.includes(cutLine(TODAY_LIMIT)), "no cut marker");
		assert.match(out, /^## What To Do Next$/m);
	});

	test("a plan under the budget is not cut", () => {
		write("site", "next.md", NEXT);
		assert.ok(!todayContext(vault, projectOf("site")).includes(cutLine(TODAY_LIMIT)));
	});

	test("open tasks past the cap are counted, not dumped", () => {
		write("site", "next.md", NEXT);
		const many = "## Open\n\n" + Array.from({ length: 60 }, (_, i) => `- [ ] task number ${i}`).join("\n") + "\n";
		write("site", "tasks.md", many);
		const out = todayContext(vault, projectOf("site"));
		assert.match(out, /task number 0\b/);
		assert.ok(!out.includes("task number 59"));
		assert.match(out, /more open tasks/);
	});
});

describe("the vault's own session start", { skip: WSL_ONLY }, () => {
	let vault: string;
	beforeEach(() => {
		vault = makeVault();
		writeFileSync(join(vault, "vault-manifest.json"), "{}\n");
	});
	afterEach(() => rmTemp(vault));

	const start = () =>
		hookContext(runScript(SESSION_START, { source: "startup" }, { CLAUDE_PROJECT_DIR: vault }).stdout);

	test("carries the general project's plan when it exists", () => {
		mkdirSync(join(vault, "work", "active", "general"), { recursive: true });
		writeFileSync(join(vault, "work", "active", "general", "next.md"), NEXT.replace("Wire the contact form", "Tidy the vault"));
		const ctx = start();
		assert.match(ctx, /Plan for today: general/);
		assert.match(ctx, /Tidy the vault/);
		assert.match(ctx, /Vault File Listing/, "the vault's own context is still there");
	});

	test("adds nothing when the vault has no general plan", () => {
		assert.ok(!/Plan for today/.test(start()));
	});
});
