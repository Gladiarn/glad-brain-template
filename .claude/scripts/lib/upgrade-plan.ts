/**
 * The judgment `/om-vault-upgrade` makes before it upgrades this vault: what
 * `git pull template main` would do, file by file.
 *
 * A private brain keeps the public template as its `template` remote, so an
 * upgrade is a git merge. git already merges what it can. What it cannot tell
 * the user is which files the pull will take as they are, which it will merge
 * with their edits, which it will stop on, and which template files they have
 * changed and the template has not (a local improvement worth sending back).
 * This sorts every file into those groups, on data the caller reads from git.
 * Pure: the script runs git and passes the results in.
 */

import { RETIRED_INSTRUCTION_FILES } from "./instruction-files.ts";

/** One path the template changed since the common ancestor, as `git diff --name-status` reports it. */
export type TemplateChange = { readonly status: "A" | "M" | "D"; readonly path: string };

export type UpgradeReport = {
	/** The template changed it and you did not: the pull takes the new version. */
	readonly behind: readonly string[];
	/** A template file you changed and the template did not: kept. An upstream candidate if it is an improvement. */
	readonly ahead: readonly string[];
	/** Changed on both sides and merged cleanly: review the result. */
	readonly merged: readonly string[];
	/** Changed on both sides and git cannot merge it, or a new template file where you already have one: you decide. */
	readonly conflicts: readonly string[];
	/** New in the template. */
	readonly added: readonly string[];
	/** A retired instruction file still in the vault: you move your additions out, then delete it. */
	readonly move: readonly string[];
	/** Template files with nothing to judge. */
	readonly unchanged: number;
};

/**
 * Parse `git diff --name-status --no-renames -z` output: `<status>\0<path>\0`
 * repeated. Only A, M and D can appear with `--no-renames` and
 * `--diff-filter=AMD`; a type change counts as a modification.
 */
export function parseNameStatus(out: string): TemplateChange[] {
	const parts = out.split("\0");
	const changes: TemplateChange[] = [];
	for (let i = 0; i + 1 < parts.length; i += 2) {
		const code = parts[i]!.trim();
		const path = parts[i + 1]!;
		if (code === "" || path === "") continue;
		changes.push({ status: code === "A" || code === "D" ? code : "M", path });
	}
	return changes;
}

/**
 * The conflicted paths in `git merge-tree --write-tree --name-only` output:
 * the merged tree's id on the first line, then one path per line up to the
 * first blank line (the informational messages follow it).
 */
export function parseMergeTreeConflicts(out: string): string[] {
	const lines = out.split("\n");
	const paths: string[] = [];
	for (const line of lines.slice(1)) {
		if (line === "") break;
		if (!paths.includes(line)) paths.push(line);
	}
	return paths;
}

export type TemplateChanges = {
	/** What the template changed since the common ancestor. */
	readonly upstream: readonly TemplateChange[];
	/** Paths this vault changed since the common ancestor. Includes its own notes. */
	readonly local: ReadonlySet<string>;
	/** Paths a merge of the two would stop on. */
	readonly conflicts: ReadonlySet<string>;
	/** Every file in the template's latest tree. */
	readonly templateFiles: readonly string[];
};

/**
 * Sort the template's changes by what the pull will do with each. A file only
 * the template changed is behind (or added, if new). A file both sides changed
 * is merged, or a conflict when git says it cannot merge it. A template file
 * only this vault changed is ahead. The vault's own notes are not in the
 * template's tree, so they never reach any list.
 */
export function classifyTemplateChanges(input: TemplateChanges): UpgradeReport {
	const behind: string[] = [];
	const merged: string[] = [];
	const conflicts: string[] = [];
	const added: string[] = [];
	const touchedUpstream = new Set<string>();
	for (const { status, path } of input.upstream) {
		touchedUpstream.add(path);
		if (input.conflicts.has(path)) conflicts.push(path);
		else if (input.local.has(path)) merged.push(path);
		else if (status === "A") added.push(path);
		else behind.push(path);
	}
	const ahead = input.templateFiles.filter((p) => input.local.has(p) && !touchedUpstream.has(p));
	const judged = new Set([...behind, ...merged, ...conflicts, ...added, ...ahead]);
	const unchanged = input.templateFiles.filter((p) => !judged.has(p)).length;
	return { behind, ahead, merged, conflicts, added, move: [], unchanged };
}

/**
 * `report` with every retired instruction file still in the vault listed
 * under `move`, unless the pull deletes it anyway. Claude Code reads a
 * CLAUDE.md in place of AGENTS.md, so a leftover one hides the vault's
 * conventions; the user moves their additions out and deletes it.
 */
export function withRetiredInstructionFiles(report: UpgradeReport, present: (path: string) => boolean): UpgradeReport {
	const move = RETIRED_INSTRUCTION_FILES.filter((p) => present(p) && !report.behind.includes(p));
	return { ...report, move };
}

/** The report as markdown, for the user. Every list in full: a cut list would hide a decision. */
export function formatUpgradeReport(r: UpgradeReport, from: string, to: string): string {
	const section = (title: string, what: string, paths: readonly string[]): string =>
		paths.length === 0 ? "" : `\n### ${title} (${paths.length})\n${what}\n${paths.map((p) => `- \`${p}\``).join("\n")}\n`;
	return [
		`## Upgrade plan: ${from} → ${to}`,
		`${r.unchanged} file(s) need no judgment.`,
		section("Behind", "The template changed these and you did not. The pull takes the new version and loses nothing of yours.", r.behind),
		section("Ahead — keep, and consider upstreaming", "Template files changed only in this vault. Kept as yours. An improvement every vault could use belongs in the template.", r.ahead),
		section("Merged — review", "Changed on both sides; git merges them without a conflict. Read the result.", r.merged),
		section(
			"Move out — retired instruction file",
			"Claude Code reads CLAUDE.md and skips AGENTS.md while it is here, and Gemini no longer reads GEMINI.md, so anything you added there is lost. Move what you added: from GEMINI.md into `AGENTS.md`; from CLAUDE.md into `.claude/rules/local.md`, or into `AGENTS.md` if every agent needs it. Keep `AGENTS.md` under 23 KB. Then delete the file. If you never edited it, just delete it. Nothing is merged automatically.",
			r.move,
		),
		section("Conflicts — your decision", "Changed on both sides and git cannot merge them (or a new template file where you already have one). git stops on these and leaves both versions in the file for you to resolve; nothing is overwritten.", r.conflicts),
		section("New in the template", "Added as they are.", r.added),
	]
		.filter((s) => s !== "")
		.join("\n");
}
