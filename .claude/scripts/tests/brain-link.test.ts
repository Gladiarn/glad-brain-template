/**
 * Tests for `brain link` and `brain status`: run brain.ts as a subprocess
 * against a temp vault and a temp repo, with a fake graphify on PATH.
 */

import { test, describe, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { rmTemp } from "./_helpers.ts";
import { GIT_ENV, REPO_ROOT, git, makeBin, makeRepo, makeVault, runBrain } from "./_brain-helpers.ts";

type MapFile = { projects: Record<string, { project: string; client: string | null }> };

describe("brain link", () => {
	let vault: string;
	let repo: string;
	let bin: string;
	const extra: string[] = [];
	const readMap = (): MapFile => JSON.parse(readFileSync(join(vault, "projects.map.json"), "utf8"));
	const link = (...args: string[]) => runBrain(["link", ...args], { vault, cwd: repo, binDir: bin });

	beforeEach(() => {
		vault = makeVault();
		writeFileSync(join(vault, "projects.map.json"), '{"projects":{}}\n');
		repo = makeRepo("client-site", "git@github.com:Me/Client-Site.git");
		bin = makeBin({ graphify: {} });
	});
	afterEach(() => {
		rmTemp(vault);
		rmTemp(repo);
		rmTemp(bin);
		for (const d of extra.splice(0)) rmTemp(d);
	});

	test("creates the map entry, the project files and one Index line", () => {
		const r = link("--client", "acme");
		assert.equal(r.code, 0, r.stderr);
		assert.deepEqual(readMap().projects["github.com/me/client-site"], { project: "client-site", client: "acme" });

		const next = readFileSync(join(vault, "work/active/client-site/next.md"), "utf8");
		const tasks = readFileSync(join(vault, "work/active/client-site/tasks.md"), "utf8");
		assert.match(next, /^## What To Do Next$/m);
		assert.match(tasks, /^## Open$/m);
		assert.ok(!next.includes("{{") && !tasks.includes("{{"), "a placeholder was left unfilled");
		assert.match(next, /project: "client-site"/);
		assert.match(next, /quarter: "?Q[1-4]-\d{4}"?/);
		assert.match(next, /# Next: client-site/);

		const index = readFileSync(join(vault, "work/Index.md"), "utf8");
		assert.equal(index.match(/work\/active\/client-site\/next\|client-site/g)?.length, 1);
	});

	test("running link twice is idempotent and leaves an edited next.md alone", () => {
		assert.equal(link().code, 0);
		const nextPath = join(vault, "work/active/client-site/next.md");
		writeFileSync(nextPath, "my own edits\n");
		const second = link();
		assert.equal(second.code, 0, second.stderr);
		assert.equal(readFileSync(nextPath, "utf8"), "my own edits\n");
		const index = readFileSync(join(vault, "work/Index.md"), "utf8");
		assert.equal(index.match(/work\/active\/client-site\/next\|/g)?.length, 1);
		assert.equal(Object.keys(readMap().projects).length, 1);
	});

	test("a second link without --client keeps the client already recorded", () => {
		link("--client", "acme");
		link();
		assert.equal(readMap().projects["github.com/me/client-site"]?.client, "acme");
	});

	test("the project name defaults to the repo folder name, kebab-cased", () => {
		const other = makeRepo("My Cool_Site v2", "https://github.com/me/cool.git");
		extra.push(other);
		const r = runBrain(["link"], { vault, cwd: other, binDir: bin });
		assert.equal(r.code, 0, r.stderr);
		assert.equal(readMap().projects["github.com/me/cool"]?.project, "my-cool-site-v2");
		assert.ok(existsSync(join(vault, "work/active/my-cool-site-v2/next.md")));
	});

	test("--project is used when given", () => {
		assert.equal(link("--project", "portfolio-v3").code, 0);
		assert.ok(existsSync(join(vault, "work/active/portfolio-v3/next.md")));
	});

	test("--project ../x is rejected and nothing is written", () => {
		const r = link("--project", "../x");
		assert.notEqual(r.code, 0);
		assert.match(r.stderr, /project name/i);
		assert.deepEqual(readMap().projects, {});
		assert.ok(!existsSync(join(vault, "work/x")));
		assert.ok(!existsSync(join(vault, "x")));
	});

	test("link never writes a file inside the code repo", () => {
		assert.equal(link().code, 0);
		assert.equal(git(repo, "status", "--porcelain").trim(), "");
		assert.ok(!existsSync(join(repo, "CLAUDE.md")));
		assert.ok(!existsSync(join(repo, ".mcp.json")));
	});

	test("a repo with no remote is keyed by its absolute path", () => {
		const local = makeRepo("scratch");
		extra.push(local);
		const r = runBrain(["link"], { vault, cwd: local, binDir: bin });
		assert.equal(r.code, 0, r.stderr);
		const keys = Object.keys(readMap().projects);
		assert.equal(keys.length, 1);
		assert.equal(keys[0], `path:${local}`);
	});

	test("--repo points at a repo other than the cwd", () => {
		const elsewhere = makeRepo("elsewhere", "git@github.com:me/elsewhere.git");
		extra.push(elsewhere);
		const r = runBrain(["link", "--repo", elsewhere], { vault, cwd: vault, binDir: bin });
		assert.equal(r.code, 0, r.stderr);
		assert.ok(readMap().projects["github.com/me/elsewhere"]);
	});

	test("linking the vault itself is refused", () => {
		const r = runBrain(["link"], { vault, cwd: vault, binDir: bin });
		assert.notEqual(r.code, 0);
		assert.match(r.stderr, /vault/i);
	});

	test("a repo path that does not exist is refused", () => {
		const r = runBrain(["link", "--repo", join(vault, "nope")], { vault, cwd: vault, binDir: bin });
		assert.notEqual(r.code, 0);
		assert.deepEqual(readMap().projects, {});
	});

	test("an existing placeholder bullet in Active Projects is replaced, other entries are kept", () => {
		writeFileSync(
			join(vault, "work/Index.md"),
			"# Work Notes\n\n## Active Projects\n\n- [[work/active/old/next|old]] — kept\n\n## Recently Completed\n\n-\n",
		);
		assert.equal(link().code, 0);
		const index = readFileSync(join(vault, "work/Index.md"), "utf8");
		assert.match(index, /\[\[work\/active\/old\/next\|old\]\] — kept\n- \[\[work\/active\/client-site\/next\|client-site\]\]/);
		assert.ok(index.indexOf("client-site") < index.indexOf("## Recently Completed"));
	});

	test("an Index with no Active Projects section gets one", () => {
		writeFileSync(join(vault, "work/Index.md"), "# Work Notes\n");
		assert.equal(link().code, 0);
		assert.match(readFileSync(join(vault, "work/Index.md"), "utf8"), /## Active Projects\n\n- \[\[work\/active\/client-site\/next\|client-site\]\]/);
	});

	test("runs `graphify update <repo>` when graphify is on PATH", () => {
		const r = link();
		assert.equal(r.code, 0, r.stderr);
		const log = readFileSync(join(bin, "graphify.log"), "utf8").trim().split("\n");
		assert.deepEqual(log, [`update ${repo}`]);
	});

	test("graphify runs with every LLM backend off, whatever keys the shell holds", () => {
		const probe = makeBin({ graphify: { extra: 'echo "BACKEND=$GRAPHIFY_BACKEND ANTHROPIC=${ANTHROPIC_API_KEY:+set} GEMINI=${GEMINI_API_KEY:+set}" >> "${0%/*}/env.log"' } });
		extra.push(probe);
		const r = runBrain(["link"], { vault, cwd: repo, binDir: probe, env: { ANTHROPIC_API_KEY: "sk-ant-FAKEFAKEFAKEFAKE", GEMINI_API_KEY: "AIzaFAKE" } });
		assert.equal(r.code, 0, r.stderr);
		assert.equal(readFileSync(join(probe, "env.log"), "utf8").trim(), "BACKEND=none ANTHROPIC= GEMINI=");
	});

	test("graphify's output in the repo stays out of git, through the local-only exclude file", () => {
		const writer = makeBin({ graphify: { extra: '/bin/mkdir -p "$2/graphify-out" && echo "{}" > "$2/graphify-out/graph.json"' } });
		extra.push(writer);
		for (let i = 0; i < 2; i++) {
			const r = runBrain(["link"], { vault, cwd: repo, binDir: writer });
			assert.equal(r.code, 0, r.stderr);
		}
		assert.ok(existsSync(join(repo, "graphify-out", "graph.json")));
		assert.equal(git(repo, "status", "--porcelain").trim(), "");
		const exclude = readFileSync(join(repo, ".git", "info", "exclude"), "utf8");
		assert.equal(exclude.split("\n").filter((l) => l === "graphify-out/").length, 1);
	});

	test("skips with a note when graphify is not on PATH", () => {
		const bare = makeBin();
		extra.push(bare);
		const r = runBrain(["link"], { vault, cwd: repo, binDir: bare });
		assert.equal(r.code, 0, r.stderr);
		assert.match(r.stdout, /graphify.*not (found|installed)|skipp/i);
		assert.ok(existsSync(join(vault, "work/active/client-site/next.md")));
	});

	test("a failing graphify does not fail the link", () => {
		const failing = makeBin({ graphify: { exit: 1 } });
		extra.push(failing);
		const r = runBrain(["link"], { vault, cwd: repo, binDir: failing });
		assert.equal(r.code, 0, r.stderr);
		assert.match(r.stdout, /graphify/i);
		assert.ok(readMap().projects["github.com/me/client-site"]);
	});
});

describe("brain status and dispatch", () => {
	let vault: string;
	let repo: string;
	let bin: string;
	beforeEach(() => {
		vault = makeVault();
		repo = makeRepo("site", "git@github.com:me/site.git");
		bin = makeBin();
		mkdirSync(join(vault, "work/active/site"), { recursive: true });
		writeFileSync(
			join(vault, "projects.map.json"),
			JSON.stringify({ projects: { "github.com/me/site": { project: "site", client: "acme" } } }),
		);
	});
	afterEach(() => {
		rmTemp(vault);
		rmTemp(repo);
		rmTemp(bin);
	});

	test("status names the project and client for a linked repo", () => {
		const r = runBrain(["status"], { vault, cwd: repo, binDir: bin });
		assert.equal(r.code, 0, r.stderr);
		assert.match(r.stdout, /project: site/);
		assert.match(r.stdout, /client: acme/);
	});

	test("status says so for an unlinked folder", () => {
		const other = makeRepo("other", "git@github.com:me/other.git");
		try {
			const r = runBrain(["status"], { vault, cwd: other, binDir: bin });
			assert.equal(r.code, 0, r.stderr);
			assert.match(r.stdout, /not linked/i);
		} finally {
			rmTemp(other);
		}
	});

	test("status reports whether a Gemini key is set, never its value", () => {
		const r = runBrain(["status"], { vault, cwd: repo, binDir: bin, env: { GEMINI_API_KEY: "AIzaFAKEFAKEFAKEFAKEFAKEFAKEFAKEFAKEFAKE" } });
		assert.match(r.stdout, /gemini key: set/i);
		assert.ok(!r.stdout.includes("AIzaFAKE") && !r.stderr.includes("AIzaFAKE"));
	});

	test("an unknown subcommand prints usage and fails", () => {
		const r = runBrain(["frobnicate"], { vault, cwd: repo, binDir: bin });
		assert.notEqual(r.code, 0);
		assert.match(r.stderr, /usage/i);
	});

	test("no subcommand prints usage and fails", () => {
		const r = runBrain([], { vault, cwd: repo, binDir: bin });
		assert.notEqual(r.code, 0);
		assert.match(r.stderr, /usage/i);
	});
});

describe("bin/brain wrapper", () => {
	const wrapper = join(REPO_ROOT, "bin", "brain");

	test("is executable and resolves the vault from its own location, following a symlink", () => {
		assert.ok(existsSync(wrapper), "bin/brain is missing");
		assert.ok((statSync(wrapper).mode & 0o111) !== 0, "bin/brain is not executable");
		const links = makeBin();
		try {
			symlinkSync(wrapper, join(links, "brain"));
			const env = { ...GIT_ENV, PATH: `${links}:${dirname(process.execPath)}:/usr/bin:/bin`, BRAIN_VAULT: "" };
			const r = spawnSync(join(links, "brain"), ["status"], { cwd: REPO_ROOT, encoding: "utf8", env, windowsHide: true });
			assert.equal(r.status, 0, r.stderr);
			assert.ok(r.stdout.includes(`vault: ${REPO_ROOT}`), r.stdout);
		} finally {
			rmTemp(links);
		}
	});

	test("passes its arguments and exit code through", () => {
		const env = { ...GIT_ENV, PATH: `${dirname(process.execPath)}:${process.env["PATH"] ?? ""}`, BRAIN_VAULT: "" };
		const r = spawnSync(wrapper, ["frobnicate"], { cwd: REPO_ROOT, encoding: "utf8", env, windowsHide: true });
		assert.equal(r.status, 1);
		assert.match(r.stderr, /usage/i);
	});
});
