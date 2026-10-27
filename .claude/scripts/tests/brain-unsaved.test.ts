/**
 * Tests for the unsaved-session reminder: when the previous session in a
 * project has no save on record, the next session is told, and offered a
 * way to record it. The reminder never claims anything was saved.
 */

import { test, describe, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, readFileSync, symlinkSync, utimesSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { markSaved, transcriptsDirFor, unsavedReminder } from "../lib/brain/unsaved.ts";
import { parseHookContext } from "../lib/hook-io.ts";
import { rmTemp } from "./_helpers.ts";
import { GIT_ENV, REPO_ROOT, makeRepo, tempDir } from "./_brain-helpers.ts";

const DAY = 86_400_000;

describe("markSaved and unsavedReminder", () => {
	let vault: string;
	let transcripts: string;
	const transcript = (session: string, mtime: Date, body = '{"type":"user"}\n') => {
		mkdirSync(transcripts, { recursive: true });
		const f = join(transcripts, `${session}.jsonl`);
		writeFileSync(f, body);
		utimesSync(f, mtime, mtime);
		return f;
	};
	const ago = (ms: number) => new Date(Date.now() - ms);

	beforeEach(() => {
		vault = tempDir("brain-unsaved-");
		transcripts = join(tempDir("brain-transcripts-"), "projects", "-home-me-site");
	});
	afterEach(() => {
		rmTemp(vault);
		rmTemp(join(transcripts, "..", ".."));
	});

	test("markSaved writes the ISO time to .brain/last-save/<project>", () => {
		const t = new Date("2026-10-27T09:30:00.000Z");
		markSaved(vault, "site", t);
		assert.equal(readFileSync(join(vault, ".brain", "last-save", "site"), "utf8").trim(), t.toISOString());
	});

	test("markSaved rejects a project name that could leave the folder", () => {
		assert.throws(() => markSaved(vault, "../x"));
		assert.ok(!existsSync(join(vault, ".brain", "x")));
	});

	test("a transcript newer than the last save, from another session, gives a reminder naming its date", () => {
		markSaved(vault, "site", ago(3 * DAY));
		const when = ago(1 * DAY);
		transcript("old-session", when);
		const text = unsavedReminder(vault, "site", transcripts, "current-session");
		assert.ok(text !== null);
		const day = `${when.getFullYear()}-${String(when.getMonth() + 1).padStart(2, "0")}-${String(when.getDate()).padStart(2, "0")}`;
		assert.ok(text.includes(day), text);
		assert.match(text, /`save/);
	});

	test("the reminder offers to save and never claims anything was saved", () => {
		transcript("old-session", ago(DAY));
		const text = unsavedReminder(vault, "site", transcripts, "current-session") ?? "";
		assert.ok(!/\bsaved\b/i.test(text), `claims a save: ${text}`);
		assert.match(text, /offer/i);
		assert.match(text, /only if|unless/i);
	});

	test("only the current session's transcript gives nothing", () => {
		transcript("current-session", ago(1000));
		assert.equal(unsavedReminder(vault, "site", transcripts, "current-session"), null);
	});

	test("no last-save file and an old transcript gives a reminder", () => {
		transcript("ancient", ago(60 * DAY));
		assert.ok(unsavedReminder(vault, "site", transcripts, "current-session") !== null);
	});

	test("a missing transcripts folder gives nothing", () => {
		assert.equal(unsavedReminder(vault, "site", join(vault, "nope"), "current-session"), null);
	});

	test("a transcript older than the last save gives nothing", () => {
		transcript("before", ago(5 * DAY));
		markSaved(vault, "site", ago(1 * DAY));
		assert.equal(unsavedReminder(vault, "site", transcripts, "current-session"), null);
	});

	test("the session that made the save, though it kept going afterwards, is not reported", () => {
		transcript("same-session", new Date(Date.now() + 60_000));
		markSaved(vault, "site", new Date(Date.now() + 1_000));
		assert.equal(unsavedReminder(vault, "site", transcripts, "current-session"), null);
	});

	test("an empty transcript is ignored", () => {
		transcript("empty", ago(DAY), "");
		assert.equal(unsavedReminder(vault, "site", transcripts, "current-session"), null);
	});

	test("with several unrecorded sessions the latest one is named", () => {
		const latest = ago(1 * DAY);
		transcript("a", ago(3 * DAY));
		transcript("b", latest);
		const text = unsavedReminder(vault, "site", transcripts, "current-session") ?? "";
		const day = `${latest.getFullYear()}-${String(latest.getMonth() + 1).padStart(2, "0")}-${String(latest.getDate()).padStart(2, "0")}`;
		assert.ok(text.includes(day), text);
	});

	test("without a current session id every transcript counts", () => {
		transcript("only", ago(DAY));
		assert.ok(unsavedReminder(vault, "site", transcripts, null) !== null);
	});

	test("non-transcript files are ignored", () => {
		mkdirSync(transcripts, { recursive: true });
		writeFileSync(join(transcripts, "notes.txt"), "x");
		assert.equal(unsavedReminder(vault, "site", transcripts, "c"), null);
	});

	test("another project's last save does not count", () => {
		markSaved(vault, "other", ago(0));
		transcript("old", ago(DAY));
		assert.ok(unsavedReminder(vault, "site", transcripts, "c") !== null);
	});
});

describe("transcriptsDirFor", () => {
	test("encodes the session folder the way Claude Code names its project folder", () => {
		assert.equal(transcriptsDirFor("/home/me/my.site", "/h"), "/h/.claude/projects/-home-me-my-site");
	});
});

describe("the reminder at session start", () => {
	const HOOK = join(REPO_ROOT, "bin", "brain-hook");
	let vault: string;
	let home: string;
	let repo: string;

	const startSession = (sessionId = "new-session") => {
		const env: NodeJS.ProcessEnv = { ...GIT_ENV, HOME: home, PATH: `${dirname(process.execPath)}:/usr/bin:/bin`, CLAUDE_PROJECT_DIR: repo };
		delete env["BRAIN_VAULT"];
		const r = spawnSync(HOOK, ["session-start.ts"], {
			cwd: repo,
			env,
			input: JSON.stringify({ source: "startup", session_id: sessionId }),
			encoding: "utf8",
			windowsHide: true,
			timeout: 60_000,
		});
		return parseHookContext(r.stdout, "SessionStart");
	};
	const oldTranscript = (session: string) => {
		const dir = transcriptsDirFor(repo, home);
		mkdirSync(dir, { recursive: true });
		const f = join(dir, `${session}.jsonl`);
		writeFileSync(f, '{"type":"user"}\n');
		const t = new Date(Date.now() - DAY);
		utimesSync(f, t, t);
	};

	beforeEach(() => {
		vault = tempDir("brain-unsaved-vault-");
		symlinkSync(join(REPO_ROOT, ".claude"), join(vault, ".claude"));
		writeFileSync(join(vault, "vault-manifest.json"), "{}\n");
		repo = makeRepo("site", "git@github.com:me/site.git");
		writeFileSync(
			join(vault, "projects.map.json"),
			JSON.stringify({ projects: { "github.com/me/site": { project: "site", client: null } } }),
		);
		mkdirSync(join(vault, "work/active/site"), { recursive: true });
		writeFileSync(join(vault, "work/active/site/next.md"), "---\ndate: x\n---\n\n## What To Do Next\n\n1. go\n");
		home = tempDir("brain-home-");
		mkdirSync(join(home, ".config", "second-brain"), { recursive: true });
		writeFileSync(join(home, ".config", "second-brain", ".env"), `BRAIN_VAULT=${vault}\n`);
	});
	afterEach(() => {
		rmTemp(vault);
		rmTemp(home);
		rmTemp(dirname(repo));
	});

	test("a linked repo whose last session has no save on record gets the reminder, after the plan", () => {
		oldTranscript("last-week");
		const ctx = startSession();
		assert.match(ctx, /Earlier session/);
		assert.match(ctx, /`save: /);
		assert.ok(ctx.indexOf("Plan for today") < ctx.indexOf("Earlier session"));
	});

	test("once a save is on record, the reminder goes away", () => {
		oldTranscript("last-week");
		markSaved(vault, "site", new Date());
		assert.ok(!/Earlier session/.test(startSession()));
	});

	test("no earlier transcripts, no reminder", () => {
		assert.ok(!/Earlier session/.test(startSession()));
	});
});
