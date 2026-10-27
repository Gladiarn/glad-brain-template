/**
 * One concurrent writer for memory-supersede-race.test.ts.
 *
 * For each round it waits for that round's go file, spins to the start instant
 * written in it, and makes exactly ONE markSuperseded call on the round's
 * memory with its own title. No retry and no check afterwards: a lost update
 * has to show up as a missing title, not be quietly put back by the writer.
 *
 * Run as a PROCESS, not a worker thread: the bug under test lives in the gap
 * between one process's read and its rename, and only a separate process can
 * stand in another's gap.
 */

import { existsSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { writeFileAtomic } from "../lib/atomic-write.ts";
import { markSuperseded } from "../lib/memory-supersede.ts";

const [vaultRaw, syncDir, procId, roundsRaw] = process.argv.slice(2) as [string, string, string, string];
const vault = realpathSync(vaultRaw);
const rounds = Number(roundsRaw);

writeFileSync(join(syncDir, `ready-${procId}`), "1");

for (let r = 0; r < rounds; r++) {
	const go = join(syncDir, `go-${r}`);
	// Spin, not setTimeout: a timer's granularity is wider than the race window.
	while (!existsSync(go)) {}
	const round = JSON.parse(readFileSync(go, "utf8")) as { startAt: number; rel: string; titles: string[] };
	// The system clock, not performance.now(): every writer reads the same one.
	while (Date.now() < round.startAt) {}

	const result = markSuperseded(vault, round.rel, round.titles[Number(procId)]!);
	writeFileAtomic(join(syncDir, `done-${procId}-${r}`), JSON.stringify(result));
}
