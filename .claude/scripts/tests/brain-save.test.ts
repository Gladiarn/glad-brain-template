/**
 * Tests for the save pipeline: the summary schema, the allowed-target list,
 * the Gemini protocol (write, self-check, fix), the plain-script sanity
 * check, and every way a save must fall back instead of writing. No network:
 * every Gemini call goes through an injected fake fetch.
 */

import { test, describe, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, readdirSync, readFileSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { allowedTargets, parseSummary, type SaveSummary } from "../lib/brain/save/schema.ts";
import { checkProposed } from "../lib/brain/save/sanity.ts";
import { selectFetch } from "../lib/brain/save/gemini.ts";
import { runSave } from "../lib/brain/save/pipeline.ts";
import { rmTemp } from "./_helpers.ts";
import { makeVault, tempDir, WSL_ONLY } from "./_brain-helpers.ts";

const KEY = "AIzaFAKEFAKEFAKEFAKEFAKEFAKEFAKEFAKEFAKE";
const NOW = new Date("2026-10-27T10:00:00.000Z");

const NEXT_OLD = `---
date: "2026-10-26"
quarter: Q4-2026
status: active
description: "plan"
tags:
  - work-note
---

# Next: site

## What To Do Next

1. Build the header

## Completed

- Set up hosting

## Blocked

-
`;
const NEXT_NEW = NEXT_OLD.replace("1. Build the header", "1. Wire the contact form\n2. Build the footer").replace(
	"- Set up hosting",
	"- Set up hosting\n- Built the header",
);
const TASKS_OLD = `---
date: "2026-10-26"
quarter: Q4-2026
status: active
description: "tasks"
tags:
  - work-note
---

# Tasks: site

## Open

- [ ] Build the header
- [ ] Add alt text to the hero

## Done

- [x] Set up hosting
`;
const TASKS_NEW = TASKS_OLD.replace("- [ ] Build the header\n", "- [ ] Wire the contact form\n").replace(
	"- [x] Set up hosting",
	"- [x] Set up hosting\n- [x] Build the header",
);

const SUMMARY: SaveSummary = {
	project: "site",
	kind: "session",
	done: ["Built the header"],
	addedTasks: ["Wire the contact form"],
	decisions: [],
	lessons: [],
	next: ["Wire the contact form", "Build the footer"],
	blocked: [],
};

type Step =
	| { json: unknown; prompt?: number; output?: number }
	| { status: number; body?: string }
	| { throws: Error }
	| { hang: true };

function fakeGemini(steps: Step[]) {
	const calls: { url: string; headers: Record<string, string>; body: string }[] = [];
	const fetchImpl = (async (input: string | URL | Request, init?: RequestInit) => {
		const headers: Record<string, string> = {};
		new Headers(init?.headers).forEach((v, k) => (headers[k] = v));
		calls.push({ url: String(input), headers, body: String(init?.body ?? "") });
		const step = steps[calls.length - 1];
		if (step === undefined) throw new Error("the fake Gemini ran out of scripted responses");
		if ("throws" in step) throw step.throws;
		if ("hang" in step) {
			return await new Promise<never>((_, reject) => {
				init?.signal?.addEventListener("abort", () => reject(Object.assign(new Error("aborted"), { name: "AbortError" })));
			});
		}
		if ("status" in step) return new Response(step.body ?? "{}", { status: step.status });
		const payload = {
			candidates: [{ content: { parts: [{ text: JSON.stringify(step.json) }] } }],
			usageMetadata: { promptTokenCount: step.prompt ?? 100, candidatesTokenCount: step.output ?? 50 },
		};
		return new Response(JSON.stringify(payload), { status: 200 });
	}) as typeof fetch;
	return { fetchImpl, calls };
}

/** Like fakeGemini, but each model has its own script, picked by the model name in the URL. */
function fakeGeminiByModel(byModel: Record<string, Step[]>) {
	const calls: { model: string; url: string; headers: Record<string, string>; body: string }[] = [];
	const used: Record<string, number> = {};
	const fetchImpl = (async (input: string | URL | Request, init?: RequestInit) => {
		const url = String(input);
		const model = /\/models\/([^:]+):generateContent/.exec(url)?.[1] ?? "?";
		const headers: Record<string, string> = {};
		new Headers(init?.headers).forEach((v, k) => (headers[k] = v));
		calls.push({ model, url, headers, body: String(init?.body ?? "") });
		const n = (used[model] = (used[model] ?? 0) + 1);
		const step = byModel[model]?.[n - 1];
		if (step === undefined) throw new Error(`the fake Gemini has no scripted response ${n} for ${model}`);
		if ("throws" in step) throw step.throws;
		if ("hang" in step) {
			return await new Promise<never>((_, reject) => {
				init?.signal?.addEventListener("abort", () => reject(Object.assign(new Error("aborted"), { name: "AbortError" })));
			});
		}
		if ("status" in step) return new Response(step.body ?? "{}", { status: step.status });
		const payload = {
			candidates: [{ content: { parts: [{ text: JSON.stringify(step.json) }] } }],
			usageMetadata: { promptTokenCount: step.prompt ?? 100, candidatesTokenCount: step.output ?? 50 },
		};
		return new Response(JSON.stringify(payload), { status: 200 });
	}) as typeof fetch;
	return { fetchImpl, calls };
}

const M1 = "gemini-3.5-flash-lite";
const M2 = "gemini-3.1-flash-lite";
const M3 = "gemini-3.8-flash";

const write = (files: { path: string; content: string }[]) => ({ json: { files } });
const OK = { json: { ok: true, problems: [] } };
const BAD = (...problems: string[]) => ({ json: { ok: false, problems } });

describe("parseSummary", { skip: WSL_ONLY }, () => {
	test("accepts a full valid summary", () => {
		const r = parseSummary({ ...SUMMARY, clientNote: "prefers Fridays" });
		assert.ok(r.ok);
		if (r.ok) assert.equal(r.summary.clientNote, "prefers Fridays");
	});

	test("rejects the wrong shape with a reason", () => {
		const bad: unknown[] = [
			null,
			"text",
			{ ...SUMMARY, project: "../x" },
			{ ...SUMMARY, project: "" },
			{ ...SUMMARY, kind: "weekly" },
			{ ...SUMMARY, done: "not an array" },
			{ ...SUMMARY, done: [1] },
			{ ...SUMMARY, decisions: [{ title: "x" }] },
			{ ...SUMMARY, lessons: [{ type: "rumor", text: "x" }] },
			{ ...SUMMARY, kind: "item" },
			{ ...SUMMARY, done: Array.from({ length: 500 }, () => "x") },
			{ ...SUMMARY, next: ["x".repeat(20_000)] },
		];
		for (const b of bad) {
			const r = parseSummary(b);
			assert.equal(r.ok, false, JSON.stringify(b)?.slice(0, 80));
			if (!r.ok) assert.ok(r.error.length > 0);
		}
	});

	test("an item summary needs itemText", () => {
		assert.ok(parseSummary({ ...SUMMARY, kind: "item", itemText: "use Stripe" }).ok);
	});

	test("missing optional arrays default to empty", () => {
		const r = parseSummary({ project: "site", kind: "session", next: ["a"] });
		assert.ok(r.ok);
		if (r.ok) assert.deepEqual(r.summary.done, []);
	});
});

describe("allowedTargets", { skip: WSL_ONLY }, () => {
	let vault: string;
	beforeEach(() => {
		vault = makeVault();
	});
	afterEach(() => rmTemp(vault));

	test("is the project folder files, the index and the brain notes, nothing else", () => {
		const t = allowedTargets(vault, "site", NOW);
		assert.deepEqual(t.sort(), [
			"brain/Gotchas.md",
			"brain/Key Decisions.md",
			"brain/Patterns.md",
			"work/Index.md",
			"work/active/site/decisions.md",
			"work/active/site/next.md",
			"work/active/site/sessions/2026-10-27.md",
			"work/active/site/tasks.md",
		]);
	});

	test("adds the client note when the map names a client for the project", () => {
		writeFileSync(
			join(vault, "projects.map.json"),
			JSON.stringify({ projects: { "github.com/me/site": { project: "site", client: "acme" } } }),
		);
		assert.ok(allowedTargets(vault, "site", NOW).includes("clients/acme.md"));
		assert.ok(!allowedTargets(vault, "other", NOW).includes("clients/acme.md"));
	});

	test("never adds a client note whose name could leave clients/", () => {
		writeFileSync(
			join(vault, "projects.map.json"),
			JSON.stringify({ projects: { "github.com/me/site": { project: "site", client: "../brain/Gotchas" } } }),
		);
		assert.ok(!allowedTargets(vault, "site", NOW).some((p) => p.startsWith("clients/")));
	});
});

describe("checkProposed (the plain-script sanity check)", { skip: WSL_ONLY }, () => {
	const old = "---\ndate: x\n---\n\n# Title\n\n## Keep\n\nreal content here that matters\n\n## Other\n\nmore content that also matters a lot\n";
	test("passes an unchanged or grown file", () => {
		assert.equal(checkProposed([{ path: "brain/Gotchas.md", old, next: old + "\n- new lesson\n" }], 0.4), null);
	});

	test("rejects a file that shrinks by more than the limit", () => {
		const r = checkProposed([{ path: "brain/Gotchas.md", old, next: old.slice(0, Math.floor(old.length * 0.5)) }], 0.4);
		assert.match(r ?? "", /shrink/i);
	});

	test("allows a shrink within the limit", () => {
		const next = old.replace("real content here that matters", "real content");
		assert.equal(checkProposed([{ path: "brain/Gotchas.md", old, next }], 0.4), null);
	});

	test("rejects a file that drops a heading that had content", () => {
		const next = old.replace("## Other\n\nmore content that also matters a lot\n", "padding padding padding padding padding padding padding padding\n");
		assert.match(checkProposed([{ path: "brain/Gotchas.md", old, next }], 0.9) ?? "", /heading/i);
	});

	test("allows dropping an empty heading", () => {
		const o = old + "\n## Empty\n\n-\n";
		assert.equal(checkProposed([{ path: "brain/Gotchas.md", old: o, next: old }], 0.4), null);
	});

	test("rejects a file that loses its frontmatter", () => {
		const next = old.replace(/^---[\s\S]*?---\n/, "");
		assert.match(checkProposed([{ path: "brain/Gotchas.md", old, next }], 0.9) ?? "", /frontmatter/i);
	});

	test("rejects emptying a non-empty file", () => {
		assert.match(checkProposed([{ path: "brain/Gotchas.md", old, next: "  \n" }], 0.4) ?? "", /empty/i);
	});

	test("next.md may shrink, since it is rewritten in place, but keeps its headings", () => {
		const o = "---\ndate: x\n---\n\n# Next\n\n## What To Do Next\n\n" + "1. a long old step that is now done\n".repeat(10) + "\n## Completed\n\n- one\n";
		const shrunk = "---\ndate: x\n---\n\n# Next\n\n## What To Do Next\n\n1. new step\n\n## Completed\n\n- one\n";
		assert.equal(checkProposed([{ path: "work/active/site/next.md", old: o, next: shrunk }], 0.4), null);
		const noHeading = "---\ndate: x\n---\n\n# Next\n\n1. new step\n";
		assert.match(checkProposed([{ path: "work/active/site/next.md", old: o, next: noHeading }], 0.4) ?? "", /heading/i);
	});

	test("a brand-new file is only checked for being non-empty", () => {
		assert.equal(checkProposed([{ path: "work/active/site/decisions.md", old: null, next: "# Decisions\n" }], 0.4), null);
		assert.match(checkProposed([{ path: "work/active/site/decisions.md", old: null, next: "" }], 0.4) ?? "", /empty/i);
	});
});

describe("selectFetch", { skip: WSL_ONLY }, () => {
	test("BRAIN_GEMINI_FAKE is honoured only under NODE_ENV=test", () => {
		const dir = makeVault();
		try {
			assert.equal(selectFetch({ BRAIN_GEMINI_FAKE: dir }), globalThis.fetch);
			assert.equal(selectFetch({ NODE_ENV: "production", BRAIN_GEMINI_FAKE: dir }), globalThis.fetch);
			assert.notEqual(selectFetch({ NODE_ENV: "test", BRAIN_GEMINI_FAKE: dir }), globalThis.fetch);
			assert.equal(selectFetch({ NODE_ENV: "test" }), globalThis.fetch);
		} finally {
			rmTemp(dir);
		}
	});
});

describe("runSave", { skip: WSL_ONLY }, () => {
	let vault: string;
	const read = (rel: string) => readFileSync(join(vault, rel), "utf8");
	const exists = (rel: string) => existsSync(join(vault, rel));
	const put = (rel: string, text: string) => {
		mkdirSync(join(vault, rel, ".."), { recursive: true });
		writeFileSync(join(vault, rel), text);
	};
	const snapshot = (): string => {
		const out: string[] = [];
		const walk = (d: string) => {
			for (const e of readdirSync(join(vault, d), { withFileTypes: true })) {
				const rel = d === "" ? e.name : `${d}/${e.name}`;
				if (rel === ".brain") continue;
				if (e.isDirectory()) walk(rel);
				else out.push(`${rel}\n${read(rel)}`);
			}
		};
		walk("");
		return out.sort().join("\n--\n");
	};
	const logLines = () =>
		exists(".brain/save-log.jsonl")
			? read(".brain/save-log.jsonl")
					.trim()
					.split("\n")
					.map((l) => JSON.parse(l) as Record<string, unknown>)
			: [];
	const env = { GEMINI_API_KEY: KEY } as NodeJS.ProcessEnv;
	const goodFiles = () => [
		{ path: "work/active/site/next.md", content: NEXT_NEW },
		{ path: "work/active/site/tasks.md", content: TASKS_NEW },
	];

	beforeEach(() => {
		vault = makeVault();
		put("work/active/site/next.md", NEXT_OLD);
		put("work/active/site/tasks.md", TASKS_OLD);
		put("brain/Gotchas.md", "---\ndate: x\n---\n\n# Gotchas\n\n- An old gotcha that matters\n");
	});
	afterEach(() => rmTemp(vault));

	test("happy path: files written, next.md replaced not appended, one log line, hooks called", async () => {
		const { fetchImpl, calls } = fakeGemini([write(goodFiles()), OK]);
		const saved: string[] = [];
		const marked: string[] = [];
		const r = await runSave({
			vaultRoot: vault,
			summary: SUMMARY,
			fetchImpl,
			now: NOW,
			env,
			hooks: { commitPush: (m) => void saved.push(m), markSaved: (p) => void marked.push(p) },
		});
		assert.equal(r.outcome, "saved");
		assert.deepEqual(r.files.sort(), ["work/active/site/next.md", "work/active/site/tasks.md"]);
		assert.equal(read("work/active/site/next.md"), NEXT_NEW);
		assert.equal(read("work/active/site/tasks.md"), TASKS_NEW);
		assert.equal(read("work/active/site/next.md").match(/## What To Do Next/g)?.length, 1);
		assert.equal(calls.length, 2);
		assert.deepEqual(saved, ["brain: save site"]);
		assert.deepEqual(marked, ["site"]);

		const lines = logLines();
		assert.equal(lines.length, 1);
		assert.deepEqual(
			{ ...lines[0], reason: undefined },
			{
				ts: NOW.toISOString(),
				project: "site",
				model: M1,
				modelsTried: [M1],
				promptTokens: 200,
				outputTokens: 100,
				rounds: 1,
				outcome: "saved",
				reason: undefined,
			},
		);
		assert.deepEqual(readdirSync(join(vault, "work/active/site")).filter((f) => f.endsWith(".tmp")), []);
	});

	test("the request uses the configured model, a header key, and JSON mode, with the key nowhere else", async () => {
		writeFileSync(join(vault, "brain.config.json"), JSON.stringify({ geminiModel: "gemini-test-model" }));
		const { fetchImpl, calls } = fakeGemini([write(goodFiles()), OK]);
		await runSave({ vaultRoot: vault, summary: SUMMARY, fetchImpl, now: NOW, env, hooks: {} });
		const c = calls[0]!;
		assert.ok(c.url.startsWith("https://generativelanguage.googleapis.com/v1beta/models/gemini-test-model:generateContent"));
		assert.equal(c.headers["x-goog-api-key"], KEY);
		assert.ok(!c.url.includes(KEY) && !c.url.includes("key="), "key in the url");
		assert.ok(!c.body.includes(KEY), "key in the body");
		assert.equal(JSON.parse(c.body).generationConfig.responseMimeType, "application/json");
		assert.equal(lastModel(), "gemini-test-model");
		function lastModel() {
			return logLines().at(-1)?.["model"];
		}
	});

	test("the write prompt carries the summary, the allowed paths and the current files", async () => {
		const { fetchImpl, calls } = fakeGemini([write(goodFiles()), OK]);
		await runSave({ vaultRoot: vault, summary: SUMMARY, fetchImpl, now: NOW, env, hooks: {} });
		const body = calls[0]!.body;
		assert.ok(body.includes("Wire the contact form"));
		assert.ok(body.includes("work/active/site/next.md"));
		assert.ok(body.includes("Set up hosting"), "the current next.md is not in the prompt");
	});

	test("an item save puts the item text in the prompt", async () => {
		const { fetchImpl, calls } = fakeGemini([write(goodFiles()), OK]);
		await runSave({
			vaultRoot: vault,
			summary: { ...SUMMARY, kind: "item", itemText: "always pin the node version" },
			fetchImpl,
			now: NOW,
			env,
			hooks: {},
		});
		assert.ok(calls[0]!.body.includes("always pin the node version"));
	});

	test("a path outside the allowed list sends the whole save to the fallback, nothing touched", async () => {
		const evil = [
			"work/active/other/next.md",
			"../outside.md",
			"/etc/passwd",
			"work/active/site/../other/next.md",
			"brain/Memories.md",
			"work\\active\\site\\next.md",
			"work/active/site/next.md\u0000.png",
			".claude/settings.json",
			"clients/acme.md",
		];
		for (const path of evil) {
			const before = snapshot();
			const { fetchImpl, calls } = fakeGemini([write([...goodFiles(), { path, content: "x\n" }])]);
			const r = await runSave({ vaultRoot: vault, summary: SUMMARY, fetchImpl, now: NOW, env, hooks: {} });
			assert.equal(r.outcome, "fallback", path);
			assert.match(r.reason ?? "", /allowed/i, path);
			assert.equal(snapshot(), before, `${path}: a file changed`);
			assert.equal(calls.length, 1, path);
		}
	});

	test("two files with the same path in one answer are refused", async () => {
		const before = snapshot();
		const files = [...goodFiles(), goodFiles()[0]!];
		const { fetchImpl } = fakeGemini([write(files)]);
		const r = await runSave({ vaultRoot: vault, summary: SUMMARY, fetchImpl, now: NOW, env, hooks: {} });
		assert.equal(r.outcome, "fallback");
		assert.equal(snapshot(), before);
	});

	test("a check that fails twice falls back with nothing written", async () => {
		const before = snapshot();
		const { fetchImpl, calls } = fakeGemini([write(goodFiles()), BAD("lost the Completed list"), write(goodFiles()), BAD("still lost")]);
		const r = await runSave({ vaultRoot: vault, summary: SUMMARY, fetchImpl, now: NOW, env, hooks: {} });
		assert.equal(r.outcome, "fallback");
		assert.match(r.reason ?? "", /check/i);
		assert.equal(snapshot(), before);
		assert.equal(calls.length, 4, "write, check, fix, check");
		assert.equal(logLines().at(-1)?.["outcome"], "fallback");
		assert.equal(logLines().at(-1)?.["rounds"], 2);
	});

	test("a check that fails once and passes after the fix saves, with the fixed files", async () => {
		const fixed = [{ path: "work/active/site/next.md", content: NEXT_NEW.replace("Build the footer", "Build the footer and nav") }];
		const { fetchImpl, calls } = fakeGemini([write(goodFiles()), BAD("next.md forgot the nav"), write(fixed), OK]);
		const r = await runSave({ vaultRoot: vault, summary: SUMMARY, fetchImpl, now: NOW, env, hooks: {} });
		assert.equal(r.outcome, "saved");
		assert.match(read("work/active/site/next.md"), /Build the footer and nav/);
		assert.ok(JSON.parse(calls[2]!.body).contents[0].parts[0].text.includes("next.md forgot the nav"), "the fix pass did not get the problems");
		assert.equal(logLines().at(-1)?.["rounds"], 2);
	});

	test("a fix that proposes a bad path is refused too", async () => {
		const before = snapshot();
		const { fetchImpl } = fakeGemini([write(goodFiles()), BAD("x"), write([{ path: "../escape.md", content: "x" }])]);
		const r = await runSave({ vaultRoot: vault, summary: SUMMARY, fetchImpl, now: NOW, env, hooks: {} });
		assert.equal(r.outcome, "fallback");
		assert.equal(snapshot(), before);
	});

	test("HTTP 429, 5xx, a network error and a timeout all fall back", async () => {
		const cases: [string, Step, RegExp][] = [
			["429", { status: 429 }, /429|rate/i],
			["500", { status: 500 }, /500|server/i],
			["503", { status: 503 }, /503|server/i],
			["network", { throws: new TypeError("fetch failed") }, /network/i],
			["timeout", { hang: true }, /timed out|timeout/i],
		];
		for (const [name, step, re] of cases) {
			const before = snapshot();
			// The same failure on every model in the chain, so the last error is the one reported.
			const { fetchImpl } = fakeGemini([step, step, step]);
			const r = await runSave({ vaultRoot: vault, summary: SUMMARY, fetchImpl, now: NOW, env, hooks: {}, timeoutMs: 60 });
			assert.equal(r.outcome, "fallback", name);
			assert.match(r.reason ?? "", re, name);
			assert.equal(snapshot(), before, name);
		}
	});

	test("a rate limit in the middle (the check) still falls back with nothing written", async () => {
		const before = snapshot();
		const { fetchImpl } = fakeGemini([write(goodFiles()), { status: 429 }, { status: 429 }, { status: 429 }]);
		const r = await runSave({ vaultRoot: vault, summary: SUMMARY, fetchImpl, now: NOW, env, hooks: {} });
		assert.equal(r.outcome, "fallback");
		assert.equal(snapshot(), before);
	});

	test("a rate-limited first model hands the save to the next model in the chain", async () => {
		const { fetchImpl, calls } = fakeGeminiByModel({ [M1]: [{ status: 429 }], [M2]: [write(goodFiles()), OK] });
		const r = await runSave({ vaultRoot: vault, summary: SUMMARY, fetchImpl, now: NOW, env, hooks: {} });
		assert.equal(r.outcome, "saved");
		assert.equal(r.model, M2);
		assert.deepEqual(calls.map((c) => c.model), [M1, M2, M2]);
		assert.equal(read("work/active/site/next.md"), NEXT_NEW);
		const line = logLines().at(-1)!;
		assert.equal(line["model"], M2);
		assert.deepEqual(line["modelsTried"], [M1, M2]);
		assert.equal(line["outcome"], "saved");
	});

	test("a 404 with an empty body moves on to the next model", async () => {
		const { fetchImpl, calls } = fakeGeminiByModel({ [M1]: [{ status: 404, body: "" }], [M2]: [write(goodFiles()), OK] });
		const r = await runSave({ vaultRoot: vault, summary: SUMMARY, fetchImpl, now: NOW, env, hooks: {} });
		assert.equal(r.outcome, "saved");
		assert.deepEqual(calls.map((c) => c.model), [M1, M2, M2]);
	});

	test("a server error, a network error and a timeout each move on to the next model", async () => {
		const cases: Step[] = [{ status: 503 }, { status: 500 }, { throws: new TypeError("fetch failed") }, { hang: true }];
		for (const step of cases) {
			const { fetchImpl, calls } = fakeGeminiByModel({ [M1]: [step], [M2]: [write(goodFiles()), OK] });
			const r = await runSave({ vaultRoot: vault, summary: SUMMARY, fetchImpl, now: NOW, env, hooks: {}, timeoutMs: 60 });
			assert.equal(r.outcome, "saved", JSON.stringify(step));
			assert.deepEqual(calls.map((c) => c.model), [M1, M2, M2]);
			assert.equal(read("work/active/site/next.md"), NEXT_NEW);
			// reset for the next case
			put("work/active/site/next.md", NEXT_OLD);
			put("work/active/site/tasks.md", TASKS_OLD);
		}
	});

	test("a model that fails mid-save is replaced for the rest of it, and the failed call is retried", async () => {
		const { fetchImpl, calls } = fakeGeminiByModel({ [M1]: [write(goodFiles()), { status: 503 }], [M2]: [OK] });
		const r = await runSave({ vaultRoot: vault, summary: SUMMARY, fetchImpl, now: NOW, env, hooks: {} });
		assert.equal(r.outcome, "saved");
		assert.deepEqual(calls.map((c) => c.model), [M1, M1, M2]);
		const line = logLines().at(-1)!;
		assert.equal(line["model"], M1, "model is the one that produced the accepted proposal");
		assert.deepEqual(line["modelsTried"], [M1, M2]);
	});

	test("when every model in the chain is unavailable the save falls back, nothing written", async () => {
		const before = snapshot();
		const { fetchImpl, calls } = fakeGeminiByModel({ [M1]: [{ status: 429 }], [M2]: [{ status: 404, body: "" }], [M3]: [{ status: 503 }] });
		const r = await runSave({ vaultRoot: vault, summary: SUMMARY, fetchImpl, now: NOW, env, hooks: {} });
		assert.equal(r.outcome, "fallback");
		assert.match(r.reason ?? "", /all Gemini models were unavailable/i);
		assert.deepEqual(calls.map((c) => c.model), [M1, M2, M3]);
		assert.equal(snapshot(), before);
		assert.deepEqual(logLines().at(-1)!["modelsTried"], [M1, M2, M3]);
		assert.equal(logLines().at(-1)!["outcome"], "fallback");
		assert.deepEqual(r.files.sort(), allowedTargets(vault, "site", NOW).sort());
	});

	test("a self-check that fails twice on the first model falls back without switching models", async () => {
		const before = snapshot();
		const { fetchImpl, calls } = fakeGeminiByModel({ [M1]: [write(goodFiles()), BAD("lost a list"), write(goodFiles()), BAD("still lost")] });
		const r = await runSave({ vaultRoot: vault, summary: SUMMARY, fetchImpl, now: NOW, env, hooks: {} });
		assert.equal(r.outcome, "fallback");
		assert.match(r.reason ?? "", /check/i);
		assert.ok(calls.every((c) => c.model === M1));
		assert.equal(calls.length, 4);
		assert.equal(snapshot(), before);
		assert.deepEqual(logLines().at(-1)!["modelsTried"], [M1]);
	});

	test("a sanity-check refusal falls back without trying another model", async () => {
		const shrunk = { path: "brain/Gotchas.md", content: "---\ndate: x\n---\n\n# Gotchas\n" };
		const { fetchImpl, calls } = fakeGeminiByModel({ [M1]: [write([...goodFiles(), shrunk])] });
		const r = await runSave({ vaultRoot: vault, summary: SUMMARY, fetchImpl, now: NOW, env, hooks: {} });
		assert.equal(r.outcome, "fallback");
		assert.equal(calls.length, 1);
	});

	test("a 400, 401 or 403 rejection falls back at once without trying further models", async () => {
		for (const status of [400, 401, 403]) {
			const before = snapshot();
			const { fetchImpl, calls } = fakeGeminiByModel({ [M1]: [{ status, body: '{"error":"no"}' }] });
			const r = await runSave({ vaultRoot: vault, summary: SUMMARY, fetchImpl, now: NOW, env, hooks: {} });
			assert.equal(r.outcome, "fallback", String(status));
			assert.match(r.reason ?? "", new RegExp(String(status)));
			assert.doesNotMatch(r.reason ?? "", /all Gemini models/i);
			assert.equal(calls.length, 1, String(status));
			assert.equal(snapshot(), before);
		}
	});

	test("the chain is geminiModel then the fallbacks, without repeats", async () => {
		writeFileSync(join(vault, "brain.config.json"), JSON.stringify({ geminiModel: "m1", geminiFallbackModels: ["m1", "m2", "m2"] }));
		const { fetchImpl, calls } = fakeGeminiByModel({ m1: [{ status: 429 }], m2: [{ status: 429 }] });
		const r = await runSave({ vaultRoot: vault, summary: SUMMARY, fetchImpl, now: NOW, env, hooks: {} });
		assert.equal(r.outcome, "fallback");
		assert.deepEqual(calls.map((c) => c.model), ["m1", "m2"]);
		assert.deepEqual(logLines().at(-1)!["modelsTried"], ["m1", "m2"]);
	});

	test("with no fallback models a failing model goes straight to the Claude fallback", async () => {
		writeFileSync(join(vault, "brain.config.json"), JSON.stringify({ geminiFallbackModels: [] }));
		const { fetchImpl, calls } = fakeGeminiByModel({ [M1]: [{ status: 429 }] });
		const r = await runSave({ vaultRoot: vault, summary: SUMMARY, fetchImpl, now: NOW, env, hooks: {} });
		assert.equal(r.outcome, "fallback");
		assert.equal(calls.length, 1);
	});

	test("the key stays out of the log and the result when every model fails", async () => {
		const body = `{"error":"bad key ${KEY}"}`;
		const { fetchImpl } = fakeGeminiByModel({
			[M1]: [{ status: 429, body }],
			[M2]: [{ status: 404, body }],
			[M3]: [{ throws: new Error(`socket closed for key ${KEY}`) }],
		});
		const r = await runSave({ vaultRoot: vault, summary: SUMMARY, fetchImpl, now: NOW, env, hooks: {} });
		assert.equal(r.outcome, "fallback");
		assert.ok(!JSON.stringify(r).includes(KEY));
		assert.ok(!read(".brain/save-log.jsonl").includes(KEY));
	});

	test("a missing key falls back with the reason `no Gemini key`, without calling the network", async () => {
		const before = snapshot();
		const { fetchImpl, calls } = fakeGemini([]);
		for (const e of [{}, { GEMINI_API_KEY: "" }, { GEMINI_API_KEY: "   " }] as NodeJS.ProcessEnv[]) {
			const r = await runSave({ vaultRoot: vault, summary: SUMMARY, fetchImpl, now: NOW, env: e, hooks: {} });
			assert.equal(r.outcome, "fallback");
			assert.equal(r.reason, "no Gemini key");
		}
		assert.equal(calls.length, 0);
		assert.equal(snapshot(), before);
	});

	test("a fallback names the exact files for the Claude subagent", async () => {
		const { fetchImpl } = fakeGemini([{ status: 429 }]);
		const r = await runSave({ vaultRoot: vault, summary: SUMMARY, fetchImpl, now: NOW, env, hooks: {} });
		assert.deepEqual(r.files.sort(), allowedTargets(vault, "site", NOW).sort());
	});

	test("model output that is not the expected JSON falls back", async () => {
		for (const bad of [{ files: "nope" }, { files: [{ path: 1, content: "x" }] }, { nothing: true }, { files: [] }]) {
			const before = snapshot();
			const { fetchImpl } = fakeGemini([{ json: bad }]);
			const r = await runSave({ vaultRoot: vault, summary: SUMMARY, fetchImpl, now: NOW, env, hooks: {} });
			assert.equal(r.outcome, "fallback", JSON.stringify(bad));
			assert.equal(snapshot(), before);
		}
	});

	test("the sanity check sends a shrinking brain note to the fallback", async () => {
		const before = snapshot();
		const shrunk = { path: "brain/Gotchas.md", content: "---\ndate: x\n---\n\n# Gotchas\n" };
		const { fetchImpl } = fakeGemini([write([...goodFiles(), shrunk])]);
		const r = await runSave({ vaultRoot: vault, summary: SUMMARY, fetchImpl, now: NOW, env, hooks: {} });
		assert.equal(r.outcome, "fallback");
		assert.match(r.reason ?? "", /shrink|heading|sanity/i);
		assert.equal(snapshot(), before);
	});

	test("a write that fails midway is rolled back, so nothing is half saved", async () => {
		// tasks.md is a folder, so writing it fails after next.md was written.
		rmTemp(join(vault, "work/active/site/tasks.md"));
		mkdirSync(join(vault, "work/active/site/tasks.md"));
		const nextBefore = read("work/active/site/next.md");
		const { fetchImpl } = fakeGemini([write(goodFiles()), OK]);
		const r = await runSave({ vaultRoot: vault, summary: SUMMARY, fetchImpl, now: NOW, env, hooks: {} });
		assert.equal(r.outcome, "fallback");
		assert.equal(read("work/active/site/next.md"), nextBefore);
	});

	test("a project folder that is a symlink out of the vault is refused, nothing written outside", async () => {
		const outside = tempDir("brain-outside-");
		try {
			rmTemp(join(vault, "work/active/site"));
			symlinkSync(outside, join(vault, "work/active/site"));
			const { fetchImpl } = fakeGemini([write(goodFiles()), OK]);
			const r = await runSave({ vaultRoot: vault, summary: SUMMARY, fetchImpl, now: NOW, env, hooks: {} });
			assert.equal(r.outcome, "fallback");
			assert.match(r.reason ?? "", /outside the vault/);
			assert.deepEqual(readdirSync(outside), []);
		} finally {
			rmTemp(outside);
		}
	});

	test("the commit and mark hooks do not run when the save falls back", async () => {
		const calls: string[] = [];
		const { fetchImpl } = fakeGemini([{ status: 429 }]);
		await runSave({
			vaultRoot: vault,
			summary: SUMMARY,
			fetchImpl,
			now: NOW,
			env,
			hooks: { commitPush: () => void calls.push("commit"), markSaved: () => void calls.push("mark") },
		});
		assert.deepEqual(calls, []);
	});

	test("new files are created, with their folders", async () => {
		const files = [...goodFiles(), { path: "work/active/site/decisions.md", content: "# Decisions\n\n- Use Stripe Checkout\n" }];
		const { fetchImpl } = fakeGemini([write(files), OK]);
		const r = await runSave({ vaultRoot: vault, summary: SUMMARY, fetchImpl, now: NOW, env, hooks: {} });
		assert.equal(r.outcome, "saved");
		assert.match(read("work/active/site/decisions.md"), /Stripe Checkout/);
	});

	test("the key never appears in the log, the result, or a thrown error, whatever fails", async () => {
		const failures: Step[] = [
			{ throws: new Error(`socket closed for key ${KEY}`) },
			{ status: 500, body: `{"error":"bad key ${KEY}"}` },
			{ status: 400, body: `{"error":{"message":"API key not valid: ${KEY}"}}` },
			{ json: { files: [{ path: "../x", content: KEY }] } },
		];
		for (const step of failures) {
			const { fetchImpl } = fakeGemini([step]);
			let out = "";
			try {
				out = JSON.stringify(await runSave({ vaultRoot: vault, summary: SUMMARY, fetchImpl, now: NOW, env, hooks: {} }));
			} catch (e) {
				out = String((e as Error).message);
			}
			assert.ok(!out.includes(KEY), `the key reached the result: ${out}`);
		}
		assert.ok(!exists(".brain/save-log.jsonl") || !read(".brain/save-log.jsonl").includes(KEY));
	});

	test("every save, saved or not, appends one log line", async () => {
		const a = fakeGemini([write(goodFiles()), OK]);
		await runSave({ vaultRoot: vault, summary: SUMMARY, fetchImpl: a.fetchImpl, now: NOW, env, hooks: {} });
		const b = fakeGemini([{ status: 429 }]);
		await runSave({ vaultRoot: vault, summary: SUMMARY, fetchImpl: b.fetchImpl, now: NOW, env, hooks: {} });
		const lines = logLines();
		assert.deepEqual(lines.map((l) => l["outcome"]), ["saved", "fallback"]);
	});

	test("a failing commit hook does not turn a saved note into a failure", async () => {
		const { fetchImpl } = fakeGemini([write(goodFiles()), OK]);
		const r = await runSave({
			vaultRoot: vault,
			summary: SUMMARY,
			fetchImpl,
			now: NOW,
			env,
			hooks: {
				commitPush: () => {
					throw new Error("push failed");
				},
			},
		});
		assert.equal(r.outcome, "saved");
		assert.match(r.reason ?? "", /push failed/);
		assert.match(read("work/active/site/next.md"), /Wire the contact form/);
	});
});
