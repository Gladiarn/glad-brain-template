/**
 * Tests for the code-graph block: what a linked repo's graphify report
 * becomes in a session's first context, when a stale graph is refreshed, how
 * the session is told the plan is behind the code, and when it is offered a
 * one-time seed of an empty plan.
 */

import { test, describe, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { CODE_GRAPH_LIMIT, codeGraphBlock, headCommit, repoRoot } from "../lib/brain/code-graph.ts";
import { planIsEmpty } from "../lib/brain/today.ts";
import { lastSaveCommit, markSaved } from "../lib/brain/unsaved.ts";
import { rmTemp } from "./_helpers.ts";
import { repoKeys } from "../lib/brain/project.ts";
import { repoSessionContext, vaultSessionBlocks } from "../lib/brain/session.ts";
import { git, makeRepo, makeVault, WSL_ONLY } from "./_brain-helpers.ts";

const report = (commit: string, hubs: string[] = ["pos-payment-service.ts", "sync-queue.ts", "CheckoutModal.tsx"]) => `# Graph Report - shop  (2026-10-27)

## Corpus Check
- 1108 files · ~829,219 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 6613 nodes · 22475 edges · 228 communities (217 shown, 11 thin omitted)
- Extraction: 92% EXTRACTED · 8% INFERRED · 0% AMBIGUOUS

## Graph Freshness
- Built from commit: \`${commit.slice(0, 8)}\`
- Run \`git rev-parse HEAD\` and compare to check if the graph is stale.

## Community Hubs (Navigation)
${hubs.map((h) => `- ${h}`).join("\n")}

## God Nodes
- something long that must not be injected
`;

function commit(repo: string, file: string): string {
	writeFileSync(join(repo, file), file);
	git(repo, "add", file);
	git(repo, "commit", "-q", "-m", `add ${file}`);
	return headCommit(repo) as string;
}

function writeReport(repo: string, text: string): void {
	mkdirSync(join(repo, "graphify-out"), { recursive: true });
	writeFileSync(join(repo, "graphify-out", "GRAPH_REPORT.md"), text);
}

describe("codeGraphBlock", { skip: WSL_ONLY }, () => {
	let repo: string;
	let refreshed: string[];
	const refresh = (r: string) => {
		refreshed.push(r);
	};

	beforeEach(() => {
		repo = makeRepo("shop");
		refreshed = [];
	});
	afterEach(() => rmTemp(join(repo, "..")));

	test("a repo with no graph report gets nothing", () => {
		commit(repo, "a.txt");
		assert.equal(codeGraphBlock({ repo, refresh }), null);
		assert.deepEqual(refreshed, []);
	});

	test("carries the corpus size, the summary and the hubs, and points at graphify query", () => {
		writeReport(repo, report(commit(repo, "a.txt")));
		const out = codeGraphBlock({ repo, refresh }) as string;
		assert.match(out, /^### Code graph/);
		assert.match(out, /1108 files/);
		assert.match(out, /6613 nodes/);
		assert.match(out, /pos-payment-service\.ts, sync-queue\.ts, CheckoutModal\.tsx/);
		assert.match(out, /graphify query "<question>" --graph graphify-out\/graph\.json/);
		assert.doesNotMatch(out, /God Nodes|must not be injected/);
	});

	test("a graph built from HEAD is fresh: no refresh, no stale note", () => {
		writeReport(repo, report(commit(repo, "a.txt")));
		const out = codeGraphBlock({ repo, refresh }) as string;
		assert.deepEqual(refreshed, []);
		assert.doesNotMatch(out, /refresh/i);
	});

	test("a graph built from an older commit starts one code-only refresh and says so", () => {
		const old = commit(repo, "a.txt");
		writeReport(repo, report(old));
		commit(repo, "b.txt");
		const out = codeGraphBlock({ repo, refresh }) as string;
		assert.deepEqual(refreshed, [repo]);
		assert.match(out, new RegExp(`built at ${old.slice(0, 7)}`));
		assert.match(out, /refresh.*background/i);
	});

	test("many hubs are cut so the block stays inside its budget", () => {
		const hubs = Array.from({ length: 300 }, (_, i) => `src/very/long/module/path/number-${i}/index.ts`);
		writeReport(repo, report(commit(repo, "a.txt"), hubs));
		const out = codeGraphBlock({ repo, refresh }) as string;
		assert.ok(Buffer.byteLength(out, "utf8") <= CODE_GRAPH_LIMIT, `block is ${Buffer.byteLength(out, "utf8")} bytes`);
		assert.match(out, /number-0\/index\.ts/);
		assert.match(out, /more in graphify-out\/GRAPH_REPORT\.md/);
	});

	test("a save behind HEAD tells the session how many commits the plan is missing", () => {
		const saved = commit(repo, "a.txt");
		writeReport(repo, report(commit(repo, "b.txt")));
		commit(repo, "c.txt");
		const out = codeGraphBlock({ repo, refresh, savedCommit: saved }) as string;
		assert.match(out, new RegExp(`saved at commit ${saved.slice(0, 7)}, 2 commits ago`));
		assert.match(out, new RegExp(`git log --oneline ${saved.slice(0, 7)}\\.\\.HEAD`));
	});

	test("a save at HEAD adds no note", () => {
		const head = commit(repo, "a.txt");
		writeReport(repo, report(head));
		const out = codeGraphBlock({ repo, refresh, savedCommit: head }) as string;
		assert.doesNotMatch(out, /saved at commit/);
	});

	test("a save commit git no longer knows adds no note", () => {
		writeReport(repo, report(commit(repo, "a.txt")));
		const out = codeGraphBlock({ repo, refresh, savedCommit: "0123456789abcdef0123456789abcdef01234567" }) as string;
		assert.doesNotMatch(out, /saved at commit/);
	});

	test("an empty plan gets a one-time seed offer that does nothing without a yes", () => {
		writeReport(repo, report(commit(repo, "a.txt")));
		const out = codeGraphBlock({ repo, refresh, planEmpty: true }) as string;
		assert.match(out, /plan is empty/i);
		assert.match(out, /GRAPH_REPORT\.md/);
		assert.match(out, /git log --oneline -30/);
		assert.match(out, /unless the user (says yes|agrees)/i);
	});

	test("a filled plan gets no seed offer", () => {
		writeReport(repo, report(commit(repo, "a.txt")));
		const out = codeGraphBlock({ repo, refresh, planEmpty: false }) as string;
		assert.doesNotMatch(out, /plan is empty/i);
	});

	test("repoRoot finds the top of the repo from a subfolder", () => {
		commit(repo, "a.txt");
		mkdirSync(join(repo, "src", "deep"), { recursive: true });
		assert.equal(repoRoot(join(repo, "src", "deep")), repo);
	});
});

describe("planIsEmpty", () => {
	test("the fresh template plan is empty", () => {
		const tpl = `---\ndate: "2026-10-27"\n---\n\n%%\ncomment\n%%\n\n# Next: x\n\n## What To Do Next\n\n1.\n\n## Completed\n\n-\n\n## Key Context\n\n-\n\n## Related\n\n- [[work/active/x/tasks|Tasks]]\n`;
		assert.equal(planIsEmpty(tpl), true);
	});

	test("a plan with a next step is not empty", () => {
		assert.equal(planIsEmpty(`# Next: x\n\n## What To Do Next\n\n1. Fix checkout\n\n## Key Context\n\n-\n`), false);
	});

	test("a plan with only key context is not empty", () => {
		assert.equal(planIsEmpty(`# Next: x\n\n## What To Do Next\n\n1.\n\n## Key Context\n\n- Monorepo with a POS app\n`), false);
	});
});

describe("markSaved with a commit", { skip: WSL_ONLY }, () => {
	let vault: string;
	beforeEach(() => {
		vault = makeVault();
	});
	afterEach(() => rmTemp(vault));

	test("records the commit next to the time, and lastSaveCommit reads it back", () => {
		markSaved(vault, "shop", new Date("2026-10-27T10:00:00Z"), "abc1234def");
		assert.equal(lastSaveCommit(vault, "shop"), "abc1234def");
	});

	test("a save with no commit leaves lastSaveCommit null", () => {
		markSaved(vault, "shop", new Date("2026-10-27T10:00:00Z"));
		assert.equal(lastSaveCommit(vault, "shop"), null);
	});
});


describe("repoSessionContext with a code graph", { skip: WSL_ONLY }, () => {
	let vault: string;
	let repo: string;
	beforeEach(() => {
		vault = makeVault();
		repo = makeRepo("shop");
		writeFileSync(join(vault, "projects.map.json"), JSON.stringify({ projects: { [repoKeys(repo).path]: { project: "shop", client: null } } }));
		mkdirSync(join(vault, "work", "active", "shop"), { recursive: true });
		writeFileSync(join(vault, "work", "active", "shop", "next.md"), "# Next: shop\n\n## What To Do Next\n\n1.\n\n## Key Context\n\n-\n");
	});
	afterEach(() => {
		rmTemp(vault);
		rmTemp(join(repo, ".."));
	});

	test("a linked repo's session gets the code graph after the plan, with the seed offer and the save lag", () => {
		const saved = commit(repo, "a.txt");
		writeReport(repo, report(commit(repo, "b.txt")));
		markSaved(vault, "shop", new Date(), saved);
		mkdirSync(join(repo, "src"), { recursive: true });
		const out = repoSessionContext(vault, join(repo, "src"), { pull: false }) as string;
		assert.ok(out.indexOf("### Plan for today") < out.indexOf("### Code graph"));
		assert.match(out, /plan is empty/i);
		assert.match(out, /1 commit ago/);
	});

	test("the vault's own session gets no code graph", () => {
		writeReport(vault, report("deadbeef"));
		assert.equal(vaultSessionBlocks(vault).some((b) => b.startsWith("### Code graph")), false);
	});
});
