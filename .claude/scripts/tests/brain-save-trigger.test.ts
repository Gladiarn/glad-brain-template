/**
 * Tests for the `save` trigger: which messages are a save command and which
 * only mention the word, what the instruction tells Claude to do, and the
 * classify-message hook end to end.
 */

import { test, describe, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, symlinkSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { parseSave, saveInstruction } from "../lib/brain/save-trigger.ts";
import type { ResolvedProject } from "../lib/brain/project.ts";
import { parseHookContext } from "../lib/hook-io.ts";
import { rmTemp, runScript } from "./_helpers.ts";

const hookContext = (stdout: string): string => parseHookContext(stdout, "UserPromptSubmit");
import { GIT_ENV, REPO_ROOT, makeRepo, makeVault, tempDir, WSL_ONLY } from "./_brain-helpers.ts";

describe("parseSave", { skip: WSL_ONLY }, () => {
	test("a bare save, in any case, with surrounding whitespace or end punctuation, saves the session", () => {
		for (const p of ["save", "Save", "SAVE", "  save \n", "save.", "save!", "\tSave!!\n", "save..."]) {
			assert.deepEqual(parseSave(p), { kind: "session" }, JSON.stringify(p));
		}
	});

	test("save: with text saves that one item", () => {
		assert.deepEqual(parseSave("save: use Stripe Checkout"), { kind: "item", text: "use Stripe Checkout" });
		assert.deepEqual(parseSave("Save:use Stripe Checkout  "), { kind: "item", text: "use Stripe Checkout" });
	});

	test("save: with several lines keeps them all", () => {
		assert.deepEqual(parseSave("save:\nline1\nline2"), { kind: "item", text: "line1\nline2" });
		assert.deepEqual(parseSave("save: first\nsecond\n"), { kind: "item", text: "first\nsecond" });
	});

	test("save: with nothing after it saves the session", () => {
		assert.deepEqual(parseSave("save:"), { kind: "session" });
		assert.deepEqual(parseSave("save:   "), { kind: "session" });
		assert.deepEqual(parseSave("save:\n\n"), { kind: "session" });
	});

	test("sentences that only contain the word are not a save", () => {
		for (const p of [
			"save it",
			"add a save button",
			"save the form data",
			"autosave",
			"please save",
			"don't save",
			"save me",
			"save, then deploy",
			"saved",
			"saves",
			"",
			"   ",
		]) {
			assert.equal(parseSave(p), null, JSON.stringify(p));
		}
	});

	test("save: inside a longer message is not a trigger", () => {
		assert.equal(parseSave("note: save: this"), null);
		assert.equal(parseSave("first line\nsave: later"), null);
	});
});

describe("saveInstruction", { skip: WSL_ONLY }, () => {
	const project: ResolvedProject = {
		name: "client-site",
		dir: "/v/work/active/client-site",
		client: "acme",
		source: "remote",
	};

	test("a session save names the project, the summary file, the command and every exit code", () => {
		const text = saveInstruction({ kind: "session" }, project, "/v");
		assert.match(text, /client-site/);
		assert.match(text, /acme/);
		assert.match(text, /\/v\/bin\/brain save --summary/);
		assert.match(text, /"kind": "session"/);
		for (const code of ["0", "1", "3", "4"]) assert.match(text, new RegExp(`\\b${code}\\b`));
		assert.match(text, /saved via Gemini/);
		assert.match(text, /saved via Claude: /);
		assert.match(text, /--commit-only/);
		assert.match(text, /sonnet/i);
		assert.match(text, /save busy/i);
	});

	test("an item save carries the user's exact text", () => {
		const text = saveInstruction({ kind: "item", text: "use Stripe Checkout\nnot Elements" }, project, "/v");
		assert.match(text, /"kind": "item"/);
		assert.ok(text.includes("use Stripe Checkout\nnot Elements"));
		assert.match(text, /itemText/);
	});

	test("the JSON shape it shows names every field the save schema reads", () => {
		const text = saveInstruction({ kind: "item", text: "x" }, project, "/v");
		const block = /```json\n([\s\S]*?)\n```/.exec(text)?.[1] ?? "";
		const shape = JSON.parse(block) as Record<string, unknown>;
		const fields = ["project", "kind", "done", "addedTasks", "decisions", "lessons", "next", "blocked", "itemText"];
		assert.deepEqual(Object.keys(shape).sort(), [...fields].sort());
		assert.equal(shape["project"], "client-site");
	});

	test("it forbids writing secrets into the summary", () => {
		assert.match(saveInstruction({ kind: "session" }, project, "/v"), /never .*(key|token|secret)/i);
	});

	test("without a vault path it falls back to brain on PATH", () => {
		assert.match(saveInstruction({ kind: "session" }, project), /`brain save --summary/);
	});
});

describe("classify-message with the save trigger", { skip: WSL_ONLY }, () => {
	const SCRIPT = join(REPO_ROOT, ".claude", "scripts", "classify-message.ts");
	let vault: string;
	let home: string;
	let repo: string;
	const extra: string[] = [];

	const classifyInVault = (prompt: string) =>
		runScript(
			SCRIPT,
			{ prompt, session_id: "s-save", hook_event_name: "UserPromptSubmit" },
			{ CLAUDE_PROJECT_DIR: vault, BRAIN_VAULT: vault, CLASSIFY_HINT_STATE: join(vault, ".hint-state.json") },
		);

	const classifyViaHook = (prompt: string, projectDir: string) => {
		const env: NodeJS.ProcessEnv = {
			...GIT_ENV,
			HOME: home,
			PATH: `${dirname(process.execPath)}:/usr/bin:/bin`,
			CLAUDE_PROJECT_DIR: projectDir,
			CLASSIFY_HINT_STATE: join(vault, ".hint-state.json"),
		};
		delete env["BRAIN_VAULT"];
		return spawnSync(join(REPO_ROOT, "bin", "brain-hook"), ["classify-message.ts"], {
			cwd: projectDir,
			env,
			encoding: "utf8",
			input: JSON.stringify({ prompt, session_id: "s-save", hook_event_name: "UserPromptSubmit" }),
			windowsHide: true,
			timeout: 60_000,
		});
	};

	beforeEach(() => {
		vault = makeVault();
		symlinkSync(join(REPO_ROOT, ".claude"), join(vault, ".claude"));
		writeFileSync(join(vault, "vault-manifest.json"), "{}\n");
		repo = makeRepo("site", "git@github.com:me/site.git");
		writeFileSync(
			join(vault, "projects.map.json"),
			JSON.stringify({ projects: { "github.com/me/site": { project: "site", client: "acme" } } }),
		);
		mkdirSync(join(vault, "work", "active", "site"), { recursive: true });
		home = tempDir("brain-home-");
		mkdirSync(join(home, ".config", "second-brain"), { recursive: true });
		writeFileSync(join(home, ".config", "second-brain", ".env"), `BRAIN_VAULT=${vault}\n`);
	});
	afterEach(() => {
		rmTemp(vault);
		rmTemp(home);
		rmTemp(dirname(repo));
		for (const d of extra.splice(0)) rmTemp(d);
	});

	test("in a linked repo, `save` outputs the instruction for that project", () => {
		const r = classifyViaHook("save", repo);
		assert.equal(r.status, 0, r.stderr);
		const ctx = hookContext(r.stdout);
		assert.match(ctx, /Save requested/);
		assert.match(ctx, /project `site`/);
		assert.match(ctx, /brain save --summary/);
	});

	test("in a linked repo, `add a save button` outputs nothing", () => {
		const r = classifyViaHook("add a save button", repo);
		assert.equal(r.status, 0, r.stderr);
		assert.equal(r.stdout, "");
	});

	test("in a linked repo, an ordinary message gets no routing hints either", () => {
		const r = classifyViaHook("we decided to use Redis and shipped it", repo);
		assert.equal(r.stdout, "");
	});

	test("save: with an item reaches the instruction with the text", () => {
		const r = classifyViaHook("save: always pin the node version", repo);
		assert.match(hookContext(r.stdout), /always pin the node version/);
	});

	test("in an unlinked repo, `save` says to link first and does not offer to save", () => {
		const stranger = makeRepo("stranger", "git@github.com:me/stranger.git");
		extra.push(dirname(stranger));
		const r = classifyViaHook("save", stranger);
		assert.equal(r.status, 0, r.stderr);
		const ctx = hookContext(r.stdout);
		assert.match(ctx, /not linked/i);
		assert.match(ctx, /brain link/);
		assert.ok(!/brain save --summary/.test(ctx));
	});

	test("in an unlinked repo, an ordinary message prints nothing", () => {
		const stranger = makeRepo("stranger", "git@github.com:me/stranger.git");
		extra.push(dirname(stranger));
		assert.equal(classifyViaHook("hello there", stranger).stdout, "");
	});

	test("in the vault, `save` puts the save instruction first, for the general project", () => {
		const r = classifyInVault("save");
		assert.equal(r.code, 0, r.stderr);
		const ctx = hookContext(r.stdout);
		assert.match(ctx, /project `general`/);
		assert.ok(ctx.startsWith("## Save requested"), "the save instruction is not the first part");
	});

	test("in the vault, the save instruction comes before routing hints for the same message", () => {
		const r = classifyViaHook("save: we decided to use Redis", vault);
		// Through the global launcher the vault is silent: its own hooks handle it.
		assert.equal(r.stdout, "");
		const v = classifyInVault("save: we decided to use Redis");
		const ctx = hookContext(v.stdout);
		assert.ok(ctx.indexOf("Save requested") < ctx.indexOf("Content classification hints"), ctx);
	});

	test("in the vault, `add a save button` gets no save instruction", () => {
		const r = classifyInVault("add a save button");
		assert.ok(!r.stdout.includes("Save requested"));
	});

	test("the instruction fires every time, not once per session", () => {
		classifyInVault("save");
		assert.match(hookContext(classifyInVault("save").stdout), /Save requested/);
	});
});
