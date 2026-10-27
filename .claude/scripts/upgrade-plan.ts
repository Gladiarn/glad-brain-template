#!/usr/bin/env node
/**
 * upgrade-plan: the preflight for `/om-vault-upgrade` when it upgrades this
 * vault.
 *
 *   node --experimental-strip-types .claude/scripts/upgrade-plan.ts [--json] [--remote <name>] [--branch <name>]
 *
 * A private brain keeps the public template as its `template` remote, and
 * upgrades with `git pull template main`. This fetches that remote and reports
 * what the pull would do, file by file (see lib/upgrade-plan.ts). It never
 * changes the vault: it fetches, reads, and asks git to merge in memory
 * (`git merge-tree`, git 2.38 or later) to find the files a pull would stop
 * on. With --json it prints `{ from, to, report }`.
 */

import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { isMainModule } from "./lib/main-guard.ts";
import { resolveProjectDir } from "./lib/project-dir.ts";
import {
	classifyTemplateChanges,
	formatUpgradeReport,
	parseMergeTreeConflicts,
	parseNameStatus,
	withRetiredInstructionFiles,
} from "./lib/upgrade-plan.ts";

const TEMPLATE_URL = "https://github.com/Gladiarn/glad-brain-template.git";

function fail(message: string): never {
	process.stderr.write(`upgrade-plan: ${message}\n`);
	process.exit(1);
}

type GitResult = { readonly status: number | null; readonly stdout: string; readonly stderr: string };

function git(cwd: string, args: readonly string[]): GitResult {
	const r = spawnSync("git", args as string[], { cwd, encoding: "utf8", timeout: 120_000, windowsHide: true, maxBuffer: 64 * 1024 * 1024 });
	return { status: r.status, stdout: r.stdout ?? "", stderr: r.stderr ?? "" };
}

function gitOk(cwd: string, args: readonly string[]): string {
	const r = git(cwd, args);
	if (r.status !== 0) fail(`git ${args[0]} failed: ${r.stderr.trim().slice(0, 300)}`);
	return r.stdout;
}

function manifestVersion(json: string): string {
	try {
		const v = (JSON.parse(json) as { version?: unknown }).version;
		return typeof v === "string" ? v : "?";
	} catch {
		return "?";
	}
}

function main(): void {
	const args = process.argv.slice(2);
	const asJson = args.includes("--json");
	const opt = (name: string, fallback: string): string => {
		const i = args.indexOf(name);
		return i >= 0 ? (args[i + 1] ?? "") : fallback;
	};
	const remote = opt("--remote", "template");
	const branch = opt("--branch", "main");
	// Both go to git as arguments, never through a shell; the pattern keeps an option-looking value out.
	if (!/^[\w][\w./-]*$/.test(remote) || !/^[\w][\w./-]*$/.test(branch)) fail(`not a valid remote or branch name: ${remote} ${branch}`);

	const vault = resolveProjectDir(process.cwd());
	if (git(vault, ["rev-parse", "--git-dir"]).status !== 0) fail("this vault is not a git repository, so there is nothing to pull. Use the import mode of /om-vault-upgrade.");
	if (git(vault, ["remote", "get-url", remote]).status !== 0) {
		fail(`no \`${remote}\` remote. Add the template with: git remote add ${remote} ${TEMPLATE_URL}`);
	}

	if (gitOk(vault, ["status", "--porcelain"]).trim() !== "") {
		process.stderr.write("upgrade-plan: this vault has uncommitted changes. Commit or stash them before `git pull`, or the pull may refuse to run.\n");
	}

	gitOk(vault, ["fetch", "--quiet", "--no-tags", remote, branch]);
	const ref = `${remote}/${branch}`;
	const base = git(vault, ["merge-base", "HEAD", ref]);
	if (base.status !== 0 || base.stdout.trim() === "") {
		fail(
			`this vault and ${ref} have no common history, so \`git pull ${remote} ${branch}\` cannot merge them (a vault made with GitHub's "Use this template" button starts this way). Use the import mode of /om-vault-upgrade with a fresh clone of the template as the source.`,
		);
	}
	const ancestor = base.stdout.trim();

	const upstream = parseNameStatus(gitOk(vault, ["diff", "--name-status", "--no-renames", "--diff-filter=AMD", "-z", ancestor, ref]));
	const local = new Set(gitOk(vault, ["diff", "--name-only", "--no-renames", "-z", ancestor, "HEAD"]).split("\0").filter((p) => p !== ""));
	const templateFiles = gitOk(vault, ["ls-tree", "-r", "--name-only", "-z", ref]).split("\0").filter((p) => p !== "");

	// A merge in memory: exit 1 means conflicts, with the conflicted paths listed.
	const merge = git(vault, ["merge-tree", "--write-tree", "--name-only", "HEAD", ref]);
	let conflicts = new Set<string>();
	if (merge.status === 1) conflicts = new Set(parseMergeTreeConflicts(merge.stdout));
	else if (merge.status !== 0) {
		// git older than 2.38 has no --write-tree: treat every file both sides changed as a possible conflict.
		process.stderr.write("upgrade-plan: this git cannot test the merge (2.38 or later is needed), so every file changed on both sides is listed as a conflict to check.\n");
		conflicts = new Set(upstream.filter((c) => local.has(c.path)).map((c) => c.path));
	}

	let report = classifyTemplateChanges({ upstream, local, conflicts, templateFiles });
	report = withRetiredInstructionFiles(report, (p) => existsSync(join(vault, p)));

	const from = manifestVersion(git(vault, ["show", "HEAD:vault-manifest.json"]).stdout);
	const to = manifestVersion(git(vault, ["show", `${ref}:vault-manifest.json`]).stdout);
	process.stdout.write(asJson ? `${JSON.stringify({ from, to, report }, null, 2)}\n` : `${formatUpgradeReport(report, `v${from}`, `v${to}`)}\n`);
}

if (isMainModule(import.meta.url)) main();
