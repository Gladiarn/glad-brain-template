/**
 * Tests for the graphify integration: the code-only default, the guarded
 * Gemini path for notes, the "never Claude" rule, and `brain view`. A fake
 * graphify on PATH records its argv and the env it was given, so nothing here
 * reaches a real model.
 */

import { test, describe, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, readFileSync, utimesSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { changedNotes, graphCommand, viewGraph } from "../lib/brain/graph.ts";
import { rmTemp } from "./_helpers.ts";
import { REPO_ROOT, makeBin, makeVault, runBrain, tempDir, WSL_ONLY } from "./_brain-helpers.ts";

const KEY = "AIzaFAKEFAKEFAKEFAKEFAKEFAKEFAKEFAKEFAKE";
const ENV_PROBE = 'echo "BACKEND=$GRAPHIFY_BACKEND GEMINI=${GEMINI_API_KEY:+set} ANTHROPIC=${ANTHROPIC_API_KEY:+set} OPENAI=${OPENAI_API_KEY:+set} GOOGLE=${GOOGLE_API_KEY:+set}" >> "${0%/*}/env.log"';

const lines = (file: string): string[] =>
	existsSync(file)
		? readFileSync(file, "utf8")
				.trim()
				.split("\n")
				.filter((l) => l !== "")
		: [];

describe("repo files for the graph", { skip: WSL_ONLY }, () => {
	test(".graphifyignore keeps the machine-local and generated folders out", () => {
		const ignore = readFileSync(join(REPO_ROOT, ".graphifyignore"), "utf8").split("\n");
		for (const entry of [".obsidian/", "graphify-out/cache/", ".brain/", "bases/", "templates/"]) {
			assert.ok(ignore.includes(entry), `.graphifyignore lacks ${entry}`);
		}
	});

	test(".gitignore ignores the graph cache and .brain/ but not graph.json or the report", () => {
		const ignore = readFileSync(join(REPO_ROOT, ".gitignore"), "utf8")
			.split("\n")
			.filter((l) => !l.startsWith("#"));
		assert.ok(ignore.includes("graphify-out/cache/"));
		assert.ok(ignore.includes(".brain/"));
		assert.ok(!ignore.some((l) => /^graphify-out\/(graph\.json|GRAPH_REPORT\.md)$/.test(l)), "graph.json or the report is ignored");
		assert.ok(!ignore.includes("graphify-out/") && !ignore.includes("graphify-out"));
	});
});

describe("what the notes graph covers", { skip: WSL_ONLY }, () => {
	const notes = changedNotes(REPO_ROOT);

	test("the owner's notes are in it", () => {
		assert.ok(notes.includes("work/active/general/next.md"), notes.join("\n"));
		assert.ok(notes.includes("brain/Gotchas.md"));
		assert.ok(notes.includes("clients/Clients.md"));
	});

	test("the template's own docs and tooling are not", () => {
		const tooling = notes.filter(
			(n) =>
				/^(\.claude|\.codex|\.gemini|\.github|\.scripts|\.claude-plugin|docs|bin)\//.test(n) ||
				/(^|\/)(README|CHANGELOG|CONTRIBUTING|ARCHITECTURE|AGENTS|NOTICE|Home)\.md$/.test(n) ||
				n === "brain/Skills.md",
		);
		assert.deepEqual(tooling, []);
	});
});

describe("graphCommand", { skip: WSL_ONLY }, () => {
	let vault: string;
	let bin: string;
	const log = () => lines(join(bin, "graphify.log"));
	const envLog = () => lines(join(bin, "env.log"));
	const baseEnv = (extra: Record<string, string> = {}): NodeJS.ProcessEnv => ({ PATH: bin, ...extra });

	beforeEach(() => {
		vault = makeVault();
		writeFileSync(join(vault, ".graphifyignore"), readFileSync(join(REPO_ROOT, ".graphifyignore"), "utf8"));
		bin = makeBin({ graphify: { extra: ENV_PROBE } });
		for (const n of ["one", "two", "three"]) writeFileSync(join(vault, `${n}.md`), `# ${n}\n`);
	});
	afterEach(() => {
		rmTemp(vault);
		rmTemp(bin);
	});

	test("without --notes it runs the code-only update, never sets a model, and turns every LLM backend off", () => {
		const r = graphCommand({
			vaultRoot: vault,
			notes: false,
			yes: false,
			env: baseEnv({ GEMINI_API_KEY: KEY, ANTHROPIC_API_KEY: "sk-ant-FAKEFAKEFAKEFAKEFAKE", OPENAI_API_KEY: "sk-FAKEFAKEFAKEFAKEFAKEFAKE" }),
		});
		assert.equal(r.ran, true, r.message);
		assert.deepEqual(log(), [`update ${vault}`]);
		assert.ok(!log().join(" ").includes("--model"));
		assert.deepEqual(envLog(), ["BACKEND=none GEMINI= ANTHROPIC= OPENAI= GOOGLE="]);
	});

	test("without graphify installed it says so and runs nothing", () => {
		const bare = makeBin();
		try {
			const r = graphCommand({ vaultRoot: vault, notes: false, yes: false, env: { PATH: bare } });
			assert.equal(r.ran, false);
			assert.match(r.message, /graphify is not installed/i);
		} finally {
			rmTemp(bare);
		}
	});

	test("a graphify that fails is reported, not thrown", () => {
		const failing = makeBin({ graphify: { exit: 2 } });
		try {
			const r = graphCommand({ vaultRoot: vault, notes: false, yes: false, env: { PATH: failing } });
			assert.equal(r.ran, false);
			assert.match(r.message, /exit(ed)? 2/);
		} finally {
			rmTemp(failing);
		}
	});

	test("--notes without --yes states the changed-note count and runs nothing", () => {
		const r = graphCommand({ vaultRoot: vault, notes: true, yes: false, env: baseEnv({ GEMINI_API_KEY: KEY }) });
		assert.equal(r.ran, false);
		// three notes plus work/Index.md; templates/ is ignored by .graphifyignore
		assert.match(r.message, /\b4\b/);
		assert.match(r.message, /--yes/);
		assert.match(r.message, /Gemini/);
		assert.deepEqual(log(), []);
	});

	test("the count covers only notes changed since the last graph build", () => {
		mkdirSync(join(vault, "graphify-out"));
		const graph = join(vault, "graphify-out", "graph.json");
		writeFileSync(graph, "{}");
		utimesSync(graph, new Date(Date.now() - 1_800_000), new Date(Date.now() - 1_800_000));
		const past = new Date(Date.now() - 3_600_000);
		for (const f of ["one.md", "two.md", join("work", "Index.md")]) utimesSync(join(vault, f), past, past);
		const r = graphCommand({ vaultRoot: vault, notes: true, yes: false, env: baseEnv() });
		assert.match(r.message, /\b1\b/);
	});

	test("with nothing changed there is nothing to send", () => {
		mkdirSync(join(vault, "graphify-out"));
		writeFileSync(join(vault, "graphify-out", "graph.json"), "{}");
		const past = new Date(Date.now() - 3_600_000);
		for (const f of ["one.md", "two.md", "three.md", join("work", "Index.md")]) utimesSync(join(vault, f), past, past);
		const r = graphCommand({ vaultRoot: vault, notes: true, yes: true, env: baseEnv({ GEMINI_API_KEY: KEY }) });
		assert.equal(r.ran, false);
		assert.match(r.message, /nothing/i);
		assert.deepEqual(log(), []);
	});

	test("--notes --yes without a Gemini key refuses, and says it will not fall back to Claude", () => {
		const r = graphCommand({ vaultRoot: vault, notes: true, yes: true, env: baseEnv({ ANTHROPIC_API_KEY: "sk-ant-FAKEFAKEFAKEFAKEFAKE" }) });
		assert.equal(r.ran, false);
		assert.match(r.message, /GEMINI_API_KEY/);
		assert.match(r.message, /Claude/);
		assert.deepEqual(log(), []);
	});

	test("--notes --yes with the key runs the headless Gemini extract with the configured model", () => {
		writeFileSync(join(vault, "brain.config.json"), JSON.stringify({ geminiModel: "gemini-test-model" }));
		const r = graphCommand({
			vaultRoot: vault,
			notes: true,
			yes: true,
			env: baseEnv({ GEMINI_API_KEY: KEY, ANTHROPIC_API_KEY: "sk-ant-FAKEFAKEFAKEFAKEFAKE", GOOGLE_API_KEY: "other" }),
		});
		assert.equal(r.ran, true, r.message);
		assert.deepEqual(log(), [`extract ${vault} --backend gemini --model gemini-test-model --api-timeout 60`]);
		assert.deepEqual(envLog(), ["BACKEND=gemini GEMINI=set ANTHROPIC= OPENAI= GOOGLE="]);
		assert.ok(!r.message.includes(KEY));
	});

	test("the default model comes from the config defaults", () => {
		graphCommand({ vaultRoot: vault, notes: true, yes: true, env: baseEnv({ GEMINI_API_KEY: KEY }) });
		assert.match(log()[0] ?? "", /--model gemini-3\.8-flash --api-timeout 60$/);
	});

	test("a notes run that hangs is stopped and reported, not left waiting for hours", () => {
		const hanging = makeBin({ graphify: { extra: "sleep 30" } });
		try {
			const started = Date.now();
			const r = graphCommand({
				vaultRoot: vault,
				notes: true,
				yes: true,
				env: { ...baseEnv({ GEMINI_API_KEY: KEY }), PATH: `${hanging}:/usr/bin:/bin`, BRAIN_GRAPH_NOTES_TIMEOUT_MS: "1500" },
			});
			assert.ok(Date.now() - started < 15_000, "the run was not stopped");
			assert.match(r.message, /did not finish|timed out|stopped/i);
			assert.match(r.message, /Gemini/);
			assert.ok(!r.message.includes(KEY));
		} finally {
			rmTemp(hanging);
		}
	});

	test("a detached run returns at once, starts graphify, and logs to .brain/graph.log", async () => {
		const r = graphCommand({ vaultRoot: vault, notes: true, yes: true, detached: true, env: baseEnv({ GEMINI_API_KEY: KEY }) });
		assert.equal(r.ran, true, r.message);
		assert.match(r.message, /background/i);
		for (let i = 0; i < 100 && log().length === 0; i++) await new Promise((res) => setTimeout(res, 50));
		assert.deepEqual(log(), [`extract ${vault} --backend gemini --model gemini-3.8-flash --api-timeout 60`]);
		assert.ok(existsSync(join(vault, ".brain", "graph.log")));
	});
});

describe("viewGraph", { skip: WSL_ONLY }, () => {
	let vault: string;
	let bin: string;
	let scratch: string;
	const order = () => lines(join(scratch, "order.log"));
	const opener = (name: string, exit: number, extra = "") => `#!/bin/sh\nprintf '%s\\n' "${name} $*" >> "${scratch}/order.log"\n${extra}\nexit ${exit}\n`;
	const install = (scripts: Record<string, string>) => {
		for (const [name, body] of Object.entries(scripts)) {
			const f = join(bin, name);
			writeFileSync(f, body, { mode: 0o755 });
		}
	};

	beforeEach(() => {
		vault = makeVault();
		bin = makeBin();
		scratch = tempDir("brain-view-");
		mkdirSync(join(vault, "graphify-out"));
		writeFileSync(join(vault, "graphify-out", "graph.html"), "<html></html>");
	});
	afterEach(() => {
		rmTemp(vault);
		rmTemp(bin);
		rmTemp(scratch);
	});

	test("with no graph it says to run brain graph first", () => {
		rmTemp(join(vault, "graphify-out"));
		const r = viewGraph({ vaultRoot: vault, env: { PATH: bin } });
		assert.equal(r.opened, false);
		assert.match(r.message, /run brain graph first/i);
	});

	test("uses wslview first and stops there when it works", () => {
		install({ wslview: opener("wslview", 0), "explorer.exe": opener("explorer.exe", 0), "xdg-open": opener("xdg-open", 0), wslpath: opener("wslpath", 0, "printf '%s\\n' 'C:\\fake\\graph.html'") });
		const r = viewGraph({ vaultRoot: vault, env: { PATH: bin } });
		assert.equal(r.opened, true, r.message);
		assert.deepEqual(order(), [`wslview ${join(vault, "graphify-out", "graph.html")}`]);
	});

	test("falls back to explorer.exe with the Windows path from wslpath -w, then to xdg-open", () => {
		install({
			wslview: opener("wslview", 1),
			"explorer.exe": opener("explorer.exe", 5),
			"xdg-open": opener("xdg-open", 0),
			wslpath: opener("wslpath", 0, "printf '%s\\n' 'C:\\fake\\graph.html'"),
		});
		const r = viewGraph({ vaultRoot: vault, env: { PATH: bin } });
		assert.equal(r.opened, true, r.message);
		const seen = order();
		assert.equal(seen.length, 4);
		assert.ok(seen[0]!.startsWith("wslview "));
		assert.ok(seen[1]!.startsWith("wslpath -w "));
		assert.equal(seen[2], "explorer.exe C:\\fake\\graph.html");
		assert.equal(seen[3], `xdg-open ${join(vault, "graphify-out", "graph.html")}`);
	});

	test("explorer.exe exiting 1 still counts as opened, since it does that on success", () => {
		install({ "explorer.exe": opener("explorer.exe", 1), wslpath: opener("wslpath", 0, "printf '%s\\n' 'C:\\fake\\graph.html'"), "xdg-open": opener("xdg-open", 0) });
		const r = viewGraph({ vaultRoot: vault, env: { PATH: bin } });
		assert.equal(r.opened, true);
		assert.ok(!order().some((l) => l.startsWith("xdg-open")));
	});

	test("skips an opener that is not installed", () => {
		install({ "xdg-open": opener("xdg-open", 0) });
		const r = viewGraph({ vaultRoot: vault, env: { PATH: bin } });
		assert.equal(r.opened, true);
		assert.equal(order().length, 1);
	});

	test("when nothing can open it, it gives the path to open by hand", () => {
		const r = viewGraph({ vaultRoot: vault, env: { PATH: bin } });
		assert.equal(r.opened, false);
		assert.ok(r.message.includes(join(vault, "graphify-out", "graph.html")));
	});
});

describe("brain graph and brain view on the command line", { skip: WSL_ONLY }, () => {
	let vault: string;
	let bin: string;
	beforeEach(() => {
		vault = makeVault();
		bin = makeBin({ graphify: {} });
		writeFileSync(join(vault, "note.md"), "# n\n");
	});
	afterEach(() => {
		rmTemp(vault);
		rmTemp(bin);
	});

	test("brain graph runs the code-only update", () => {
		const r = runBrain(["graph"], { vault, cwd: vault, binDir: bin });
		assert.equal(r.code, 0, r.stderr);
		assert.deepEqual(lines(join(bin, "graphify.log")), [`update ${vault}`]);
	});

	test("brain graph --notes asks first, with the count", () => {
		const r = runBrain(["graph", "--notes"], { vault, cwd: vault, binDir: bin, env: { GEMINI_API_KEY: KEY } });
		assert.equal(r.code, 0, r.stderr);
		assert.match(r.stdout, /--yes/);
		assert.deepEqual(lines(join(bin, "graphify.log")), []);
		assert.ok(!r.stdout.includes(KEY));
	});

	test("brain graph --notes --yes with no key exits 1 and names the rule", () => {
		const r = runBrain(["graph", "--notes", "--yes"], { vault, cwd: vault, binDir: bin });
		assert.equal(r.code, 1);
		assert.match(r.stdout + r.stderr, /Claude/);
	});

	test("brain view with no graph exits 1", () => {
		const r = runBrain(["view"], { vault, cwd: vault, binDir: bin });
		assert.equal(r.code, 1);
		assert.match(r.stdout + r.stderr, /run brain graph first/i);
	});

	test("--yes without --notes is refused", () => {
		const r = runBrain(["graph", "--yes"], { vault, cwd: vault, binDir: bin });
		assert.equal(r.code, 1);
	});
});

describe("graph after a save", { skip: WSL_ONLY }, () => {
	const NEXT_OLD = "---\ndate: x\nquarter: Q4-2026\nstatus: active\ndescription: d\ntags:\n  - work-note\n---\n\n## What To Do Next\n\n1. a\n";
	let vault: string;
	let repo: string;
	let bin: string;
	let scratch: string;
	const run = (env: Record<string, string>) => {
		const summary = join(scratch, "s.json");
		writeFileSync(summary, JSON.stringify({ project: "site", kind: "session", next: ["b"] }));
		return runBrain(["save", "--summary", summary], { vault, cwd: repo, binDir: bin, env: { NODE_ENV: "test", ...env } });
	};
	const fixtures = () => {
		const dir = join(scratch, "fx");
		mkdirSync(dir, { recursive: true });
		writeFileSync(join(dir, "01.json"), JSON.stringify({ json: { files: [{ path: "work/active/site/next.md", content: NEXT_OLD.replace("1. a", "1. b") }] } }));
		writeFileSync(join(dir, "02.json"), JSON.stringify({ json: { ok: true, problems: [] } }));
		return dir;
	};

	beforeEach(async () => {
		const { makeRepo } = await import("./_brain-helpers.ts");
		vault = makeVault();
		repo = makeRepo("site", "git@github.com:me/site.git");
		bin = makeBin({ graphify: {} });
		scratch = tempDir("brain-after-");
		writeFileSync(join(vault, "projects.map.json"), JSON.stringify({ projects: { "github.com/me/site": { project: "site", client: null } } }));
		mkdirSync(join(vault, "work/active/site"), { recursive: true });
		writeFileSync(join(vault, "work/active/site/next.md"), NEXT_OLD);
		writeFileSync(join(vault, ".graphifyignore"), ".brain/\n");
	});
	afterEach(() => {
		rmTemp(vault);
		rmTemp(dirname(repo));
		rmTemp(bin);
		rmTemp(scratch);
	});

	test("a Gemini save with the key set starts the notes graph in the background", async () => {
		const r = run({ GEMINI_API_KEY: KEY, BRAIN_GEMINI_FAKE: fixtures() });
		assert.equal(r.code, 0, r.stdout + r.stderr);
		for (let i = 0; i < 100 && lines(join(bin, "graphify.log")).length === 0; i++) await new Promise((res) => setTimeout(res, 50));
		assert.deepEqual(lines(join(bin, "graphify.log")), [`extract ${vault} --backend gemini --model gemini-3.8-flash --api-timeout 60`]);
	});

	test("a fallback save never starts the graph", async () => {
		const r = run({ GEMINI_API_KEY: "" });
		assert.equal(r.code, 3);
		await new Promise((res) => setTimeout(res, 300));
		assert.deepEqual(lines(join(bin, "graphify.log")), []);
	});

	test("a graph that cannot start is a note, never a failed save", () => {
		const bare = makeBin();
		try {
			const summary = join(scratch, "s.json");
			writeFileSync(summary, JSON.stringify({ project: "site", kind: "session", next: ["b"] }));
			const r = runBrain(["save", "--summary", summary], { vault, cwd: repo, binDir: bare, env: { NODE_ENV: "test", GEMINI_API_KEY: KEY, BRAIN_GEMINI_FAKE: fixtures() } });
			assert.equal(r.code, 0, r.stdout + r.stderr);
			assert.match(r.stdout, /graph/i);
		} finally {
			rmTemp(bare);
		}
	});
});
