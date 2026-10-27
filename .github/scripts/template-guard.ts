#!/usr/bin/env node
/**
 * Template guard: the public template repo may only change infrastructure
 * paths, so none of the owner's notes can reach it.
 *
 *   template-guard.ts <base> <head>
 *
 * It checks the files added, changed or renamed between the two commits
 * against the globs in `.template-paths`, and fails naming each path outside
 * them. It does nothing where there is no `.template-repo` marker: a private
 * brain made from the template deletes the marker, so the guard never
 * blocks the owner's own commits.
 */

import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";

import { isMainModule } from "../../.claude/scripts/lib/main-guard.ts";
import { globToRegex, toPosix } from "./manifest-check.ts";

/** The globs in a `.template-paths` file: one per line, blank lines and `#` comments skipped. */
export function parseTemplatePaths(text: string): string[] {
	return text
		.split("\n")
		.map((l) => l.trim())
		.filter((l) => l !== "" && !l.startsWith("#"));
}

/** The paths in `paths` that no glob allows, in their original order and spelling. */
export function checkTemplatePaths(paths: readonly string[], globs: readonly string[]): string[] {
	const compiled = globs.map((g) => ({ g, re: g.includes("*") ? globToRegex(g) : null }));
	return paths.filter((p) => {
		const posix = toPosix(p);
		return !compiled.some(({ g, re }) => (re === null ? g === posix : re.test(posix)));
	});
}

function changedPaths(base: string, head: string): string[] {
	// A first push has no base: every file in the tree counts.
	const args = /^0+$/.test(base)
		? ["ls-tree", "-r", "--name-only", "-z", head]
		: ["diff", "--name-only", "--no-renames", "--diff-filter=ACMT", "-z", base, head];
	const r = spawnSync("git", args, { encoding: "utf8", windowsHide: true });
	if (r.status !== 0) throw new Error(`git failed: ${r.stderr.trim()}`);
	return r.stdout.split("\0").filter((p) => p !== "");
}

function main(argv: string[]): number {
	const [base, head] = argv;
	if (base === undefined || head === undefined) {
		console.error("usage: template-guard.ts <base-sha> <head-sha>");
		return 2;
	}
	if (!existsSync(".template-repo")) {
		console.log("template guard: no .template-repo marker, so this is not the template repo; nothing to check");
		return 0;
	}
	const globs = parseTemplatePaths(readFileSync(".template-paths", "utf8"));
	const offenders = checkTemplatePaths(changedPaths(base, head), globs);
	if (offenders.length === 0) {
		console.log("template guard: every changed path is on the template allowlist");
		return 0;
	}
	for (const p of offenders) console.error(`::error file=${p}::not on the template allowlist (.template-paths)`);
	console.error(`template guard: ${offenders.length} path(s) are outside the allowlist:`);
	for (const p of offenders) console.error(`  ${p}`);
	console.error("If a path is real infrastructure, add it to .template-paths; if it is a note, it belongs in the private brain.");
	return 1;
}

if (isMainModule(import.meta.url)) process.exit(main(process.argv.slice(2)));
