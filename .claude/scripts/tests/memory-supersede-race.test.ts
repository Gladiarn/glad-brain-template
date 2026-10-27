/**
 * markSuperseded under real concurrency: several PROCESSES marking the same
 * memory at the same instant, every title must land.
 *
 * This is the shape the deployment names — one server process per consuming
 * repo, all writing into one vault — and the protocol #328 measured: each
 * round, every writer makes ONE call on the same memory with its own title,
 * and afterwards every title must be in the file. The unguarded
 * read-modify-write lost titles while reporting success: 50 of 50 rounds in
 * #328's harness, and some round in every run of this one on Windows.
 *
 * No writer retries and nothing is repaired before the assertion, so a lost
 * update fails the round it happened in. A single-process test cannot stand a
 * writer in the gap between markSuperseded's read and its rename, so the
 * writers are child processes started together from a go file per round.
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { rmTemp, waitFor } from "./_helpers.ts";

import { writeFileAtomic } from "../lib/atomic-write.ts";
import type { SupersedeResult } from "../lib/memory-supersede.ts";

const PROCS = 4;
const ROUNDS = 50;
// Long enough for every spinning writer to have read the go file before it fires.
const START_DELAY_MS = 30;

const MEMORY = "---\ndate: 2026-07-26\nsource: mcp-capture\nscope: general\n---\n\n# old\n\nbody\n";

describe("markSuperseded race", () => {
	test("writers marking one memory at the same instant all land their title", { timeout: 120_000 }, async () => {
		const dir = mkdtempSync(join(tmpdir(), "sup-race-"));
		const vault = join(dir, "vault");
		const sync = join(dir, "sync");
		mkdirSync(sync, { recursive: true });
		const kids: ReturnType<typeof spawn>[] = [];
		try {
			const rounds = Array.from({ length: ROUNDS }, (_, r) => {
				const rel = `memories/2026/07/2026-07-26 race ${r}.md`;
				mkdirSync(dirname(join(vault, rel)), { recursive: true });
				writeFileSync(join(vault, rel), MEMORY, "utf8");
				return { rel, titles: Array.from({ length: PROCS }, (_, p) => `Writer ${p} round ${r}`) };
			});

			const childPath = fileURLToPath(new URL("./_race-child.ts", import.meta.url));
			const exits = Array.from({ length: PROCS }, (_, p) => {
				const proc = spawn(
					process.execPath,
					["--experimental-strip-types", childPath, vault, sync, String(p), String(ROUNDS)],
					{ stdio: ["ignore", "ignore", "inherit"] },
				);
				kids.push(proc);
				return new Promise<number>((res) => proc.on("exit", (c) => res(c ?? -1)));
			});
			const done = (p: number, r: number) => join(sync, `done-${p}-${r}`);

			// Only once every writer is loaded and spinning: the start must be simultaneous.
			await waitFor(() => kids.every((_, p) => existsSync(join(sync, `ready-${p}`))), 30_000);

			const lost: { round: number; title: string; outcome: string }[] = [];
			for (const [r, round] of rounds.entries()) {
				const startAt = Date.now() + START_DELAY_MS;
				// Atomic: a writer spinning on the go file must never read it half-written.
				writeFileAtomic(join(sync, `go-${r}`), JSON.stringify({ ...round, startAt }));
				await waitFor(() => kids.every((_, p) => existsSync(done(p, r))), 30_000);

				const text = readFileSync(join(vault, round.rel), "utf8");
				for (const [p, title] of round.titles.entries()) {
					if (text.includes(JSON.stringify(title))) continue;
					// Say how it went missing: silently is #328, loudly is a refusal to explain.
					const result = JSON.parse(readFileSync(done(p, r), "utf8")) as SupersedeResult;
					lost.push({ round: r, title, outcome: result.ok ? "reported success" : result.reason });
				}
			}

			(await Promise.all(exits)).forEach((code, p) => assert.equal(code, 0, `writer ${p} crashed`));
			const lostRounds = new Set(lost.map((l) => l.round)).size;
			assert.deepEqual(
				lost,
				[],
				`${lost.length} of ${PROCS * ROUNDS} titles lost, in ${lostRounds} of ${ROUNDS} rounds: ` +
					lost.map((l) => `${l.title} (${l.outcome})`).join("; "),
			);
		} finally {
			for (const k of kids) k.kill();
			rmTemp(dir);
		}
	});
});
