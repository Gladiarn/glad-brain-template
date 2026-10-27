/**
 * Tests for the pure merges setup.sh relies on: the brain's hooks into
 * Claude Code's settings, the vault section into the global CLAUDE.md, and
 * the qmdEnabled switch in brain.config.json.
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { WSL_ONLY } from "./_brain-helpers.ts";
import {
	BRAIN_HOOK_EVENTS,
	CLAUDE_MD_CLOSE,
	CLAUDE_MD_OPEN,
	mergeClaudeMd,
	mergeHooks,
	setQmdEnabled,
} from "../lib/brain/install.ts";

const VAULT = "/home/me/brain";
type Settings = { hooks?: Record<string, { matcher?: string; hooks: { type: string; command: string; timeout?: number }[] }[]>; [k: string]: unknown };

const brainEntries = (s: Settings, event: string) =>
	(s.hooks?.[event] ?? []).filter((e) => e.hooks.some((h) => h.command.includes("brain-hook")));

describe("mergeHooks", { skip: WSL_ONLY }, () => {
	test("adds exactly one brain entry to each of the five events", () => {
		const { settings } = mergeHooks({}, VAULT);
		assert.deepEqual(Object.keys((settings as Settings).hooks ?? {}).sort(), [...BRAIN_HOOK_EVENTS.map((e) => e.event)].sort());
		for (const { event, script } of BRAIN_HOOK_EVENTS) {
			const entries = brainEntries(settings as Settings, event);
			assert.equal(entries.length, 1, event);
			assert.ok(entries[0]!.hooks[0]!.command.includes(`${VAULT}/bin/brain-hook`), event);
			assert.ok(entries[0]!.hooks[0]!.command.endsWith(script), event);
			assert.equal(entries[0]!.hooks[0]!.type, "command");
		}
	});

	test("the events are the five the brain needs", () => {
		assert.deepEqual(
			BRAIN_HOOK_EVENTS.map((e) => [e.event, e.script]),
			[
				["SessionStart", "session-start.ts"],
				["UserPromptSubmit", "classify-message.ts"],
				["PostToolUse", "validate-write.ts"],
				["PreCompact", "pre-compact.ts"],
				["Stop", "stop-checklist.ts"],
			],
		);
	});

	test("a second merge changes nothing", () => {
		const first = mergeHooks({}, VAULT);
		const second = mergeHooks(first.settings, VAULT);
		assert.equal(second.changed, false);
		assert.deepEqual(second.settings, first.settings);
	});

	test("the user's own hooks and other settings are kept as they were", () => {
		const mine: Settings = {
			model: "opus",
			permissions: { allow: ["Bash(git status)"] },
			hooks: {
				SessionStart: [{ hooks: [{ type: "command", command: "echo mine" }] }],
				Stop: [{ matcher: "", hooks: [{ type: "command", command: "notify-send done" }] }],
				Notification: [{ hooks: [{ type: "command", command: "beep" }] }],
			},
		};
		const { settings } = mergeHooks(structuredClone(mine), VAULT);
		const s = settings as Settings;
		assert.equal(s["model"], "opus");
		assert.deepEqual(s["permissions"], mine["permissions"]);
		assert.deepEqual(s.hooks?.["Notification"], mine.hooks?.["Notification"]);
		assert.deepEqual(s.hooks?.["SessionStart"]?.[0], mine.hooks?.["SessionStart"]?.[0]);
		assert.deepEqual(s.hooks?.["Stop"]?.[0], mine.hooks?.["Stop"]?.[0]);
		for (const { event } of BRAIN_HOOK_EVENTS) assert.equal(brainEntries(s, event).length, 1, event);
		assert.equal(s.hooks?.["SessionStart"]?.length, 2);
	});

	test("a brain entry for a vault that moved is replaced, not duplicated", () => {
		const old = mergeHooks({}, "/old/place").settings;
		const { settings, changed } = mergeHooks(old, VAULT);
		assert.equal(changed, true);
		for (const { event } of BRAIN_HOOK_EVENTS) {
			const entries = brainEntries(settings as Settings, event);
			assert.equal(entries.length, 1, event);
			assert.ok(entries[0]!.hooks[0]!.command.includes(VAULT));
			assert.ok(!entries[0]!.hooks[0]!.command.includes("/old/place"));
		}
	});

	test("a vault path with a space is quoted in the command", () => {
		const { settings } = mergeHooks({}, "/home/me/my brain");
		const cmd = brainEntries(settings as Settings, "SessionStart")[0]!.hooks[0]!.command;
		assert.ok(cmd.startsWith("'/home/me/my brain/bin/brain-hook'"), cmd);
	});

	test("the session start hook gets room for a git pull", () => {
		const { settings } = mergeHooks({}, VAULT);
		assert.ok((brainEntries(settings as Settings, "SessionStart")[0]!.hooks[0]!.timeout ?? 0) >= 60);
	});

	test("settings that are not an object are rejected, not overwritten", () => {
		assert.throws(() => mergeHooks([] as unknown, VAULT));
		assert.throws(() => mergeHooks({ hooks: "nope" }, VAULT));
		assert.throws(() => mergeHooks({ hooks: { Stop: "nope" } }, VAULT));
	});
});

describe("mergeClaudeMd", { skip: WSL_ONLY }, () => {
	test("creates the section in an empty file, naming the vault", () => {
		const { text } = mergeClaudeMd("", VAULT);
		assert.ok(text.startsWith(CLAUDE_MD_OPEN));
		assert.ok(text.trimEnd().endsWith(CLAUDE_MD_CLOSE));
		assert.ok(text.includes(VAULT));
		assert.match(text, /save/);
		assert.match(text, /om/);
		assert.ok(text.endsWith("\n"));
	});

	test("appends after existing content and leaves it untouched", () => {
		const mine = "# My rules\n\n- be brief\n";
		const { text } = mergeClaudeMd(mine, VAULT);
		assert.ok(text.startsWith(mine));
		assert.equal(text.split(CLAUDE_MD_OPEN).length - 1, 1);
	});

	test("running again is a no-op, and a moved vault updates the one section in place", () => {
		const once = mergeClaudeMd("# mine\n", VAULT);
		const twice = mergeClaudeMd(once.text, VAULT);
		assert.equal(twice.changed, false);
		assert.equal(twice.text, once.text);
		const moved = mergeClaudeMd(once.text, "/elsewhere/brain");
		assert.equal(moved.changed, true);
		assert.equal(moved.text.split(CLAUDE_MD_OPEN).length - 1, 1);
		assert.ok(moved.text.includes("/elsewhere/brain") && !moved.text.includes(VAULT));
		assert.ok(moved.text.startsWith("# mine\n"));
	});

	test("text after the section survives an update", () => {
		const base = mergeClaudeMd("# mine\n", VAULT).text + "\n## After\n\nkeep me\n";
		const { text } = mergeClaudeMd(base, "/elsewhere/brain");
		assert.ok(text.endsWith("## After\n\nkeep me\n"));
	});

	test("a section with no closing marker is rejected rather than eating the file", () => {
		assert.throws(() => mergeClaudeMd(`# mine\n${CLAUDE_MD_OPEN}\nunterminated\n`, VAULT));
	});

	test("the section never contains a key", () => {
		assert.ok(!/AIza|GEMINI_API_KEY=/.test(mergeClaudeMd("", VAULT).text));
	});
});

describe("setQmdEnabled", { skip: WSL_ONLY }, () => {
	test("sets the flag and keeps every other key", () => {
		const out = JSON.parse(setQmdEnabled('{"geminiModel":"x","qmdEnabled":true,"maxFixRounds":2}', false));
		assert.deepEqual(out, { geminiModel: "x", qmdEnabled: false, maxFixRounds: 2 });
	});

	test("creates the config when there is none, and refuses to overwrite a broken one", () => {
		assert.deepEqual(JSON.parse(setQmdEnabled("", true)), { qmdEnabled: true });
		assert.throws(() => setQmdEnabled("{ broken", false), /not valid JSON/);
		assert.throws(() => setQmdEnabled("[1]", false));
	});
});
