/**
 * The judgment behind `/om-vault-upgrade` when it upgrades this vault: what
 * `git pull template main` would do, file by file, before it is run.
 *
 * The pure classifier is tested on plain data. The script itself runs against
 * real throwaway git repos: a template, and a vault cloned from it.
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
	classifyTemplateChanges,
	formatUpgradeReport,
	parseMergeTreeConflicts,
	parseNameStatus,
	withRetiredInstructionFiles,
	type UpgradeReport,
} from "../lib/upgrade-plan.ts";

const none = (): UpgradeReport => ({ behind: [], ahead: [], merged: [], conflicts: [], added: [], move: [], unchanged: 0 });

describe("parseNameStatus", () => {
	test("reads NUL-separated `git diff --name-status -z` output", () => {
		const out = "M\0AGENTS.md\0A\0.claude/scripts/new.ts\0D\0old/file.md\0";
		assert.deepEqual(parseNameStatus(out), [
			{ status: "M", path: "AGENTS.md" },
			{ status: "A", path: ".claude/scripts/new.ts" },
			{ status: "D", path: "old/file.md" },
		]);
	});
	test("keeps a path with spaces whole", () => {
		assert.deepEqual(parseNameStatus("M\0brain/North Star.md\0"), [{ status: "M", path: "brain/North Star.md" }]);
	});
	test("empty output is no changes", () => {
		assert.deepEqual(parseNameStatus(""), []);
	});
});

describe("parseMergeTreeConflicts", () => {
	test("lists the conflicted paths after the tree id, up to the blank line", () => {
		const out = "4b825dc642cb6eb9a060e54bf8d69288fbee4904\nAGENTS.md\nbrain/Skills.md\n\nAuto-merging README.md\nCONFLICT (content): Merge conflict in AGENTS.md\n";
		assert.deepEqual(parseMergeTreeConflicts(out), ["AGENTS.md", "brain/Skills.md"]);
	});
	test("a clean merge lists none", () => {
		assert.deepEqual(parseMergeTreeConflicts("4b825dc642cb6eb9a060e54bf8d69288fbee4904\n"), []);
	});
	test("a path listed twice, as a conflicted file is, counts once", () => {
		const out = "4b825dc642cb6eb9a060e54bf8d69288fbee4904\nAGENTS.md\nAGENTS.md\n\nmessages\n";
		assert.deepEqual(parseMergeTreeConflicts(out), ["AGENTS.md"]);
	});
});

describe("classifyTemplateChanges", () => {
	const upstream = [
		{ status: "M" as const, path: "CHANGELOG.md" },
		{ status: "M" as const, path: ".claude/settings.json" },
		{ status: "M" as const, path: "templates/Work Note.md" },
		{ status: "A" as const, path: ".claude/scripts/new-hook.ts" },
		{ status: "A" as const, path: "bases/New.base" },
		{ status: "D" as const, path: "old/removed.md" },
	];
	const local = new Set(["README.md", ".claude/settings.json", "templates/Work Note.md", "bases/New.base", "work/active/site/next.md"]);
	const conflicts = new Set([".claude/settings.json", "bases/New.base"]);
	const templateFiles = ["README.md", "CHANGELOG.md", ".claude/settings.json", "templates/Work Note.md", ".claude/scripts/new-hook.ts", "bases/New.base", "AGENTS.md"];
	const r = classifyTemplateChanges({ upstream, local, conflicts, templateFiles });

	test("changed upstream only: behind, so the pull takes it", () => {
		assert.deepEqual(r.behind, ["CHANGELOG.md", "old/removed.md"]);
	});
	test("a new template file you do not have: added", () => {
		assert.deepEqual(r.added, [".claude/scripts/new-hook.ts"]);
	});
	test("changed on both sides and merged cleanly: merged", () => {
		assert.deepEqual(r.merged, ["templates/Work Note.md"]);
	});
	test("changed on both sides and git cannot merge it, or a new template file you already have: conflicts", () => {
		assert.deepEqual(r.conflicts, [".claude/settings.json", "bases/New.base"]);
	});
	test("ahead: a template file you changed and the template did not, never your own notes", () => {
		assert.deepEqual(r.ahead, ["README.md"]);
		assert.ok(!r.ahead.includes("work/active/site/next.md"));
	});
	test("the rest of the template's files need no judgment", () => {
		assert.equal(r.unchanged, 1); // AGENTS.md
	});
});

describe("a CLAUDE.md or GEMINI.md left in the vault", () => {
	const present = (paths: readonly string[]) => (p: string) => paths.includes(p);

	test("is a move: Claude Code reads CLAUDE.md in place of AGENTS.md", () => {
		const r = withRetiredInstructionFiles(none(), present(["CLAUDE.md", "GEMINI.md", "AGENTS.md"]));
		assert.deepEqual(r.move, ["CLAUDE.md", "GEMINI.md"]);
	});
	test("a file the pull deletes is behind, not a move", () => {
		const r = withRetiredInstructionFiles({ ...none(), behind: ["CLAUDE.md"] }, present(["CLAUDE.md"]));
		assert.deepEqual(r.move, []);
	});
	test("no such file in the vault: nothing to move", () => {
		assert.deepEqual(withRetiredInstructionFiles(none(), present([])).move, []);
	});
});

describe("formatUpgradeReport", () => {
	test("names every file in full, by section, and skips empty sections", () => {
		const out = formatUpgradeReport({ ...none(), behind: ["a.md"], ahead: ["b.ts"], unchanged: 7 }, "v1.0.0", "v1.1.0");
		assert.match(out, /^## Upgrade plan: v1\.0\.0 → v1\.1\.0\n7 file\(s\) need no judgment\./);
		assert.match(out, /### Behind \(1\)[\s\S]*- `a\.md`/);
		assert.match(out, /### Ahead — keep, and consider upstreaming \(1\)[\s\S]*- `b\.ts`/);
		assert.doesNotMatch(out, /Merged|Conflicts|New in the template|Move out/);
	});

	test("conflicts are shown for the user to decide, and the report says git will not overwrite them", () => {
		const out = formatUpgradeReport({ ...none(), conflicts: ["AGENTS.md"] }, "v1.0.0", "v1.1.0");
		assert.match(out, /### Conflicts — your decision \(1\)[\s\S]*- `AGENTS\.md`/);
		assert.match(out, /git stops/i);
	});

	test("the Move out text says what to do and that nothing is merged automatically", () => {
		const out = formatUpgradeReport({ ...none(), move: ["CLAUDE.md"] }, "v1.0.0", "v1.1.0");
		assert.match(out, /### Move out — retired instruction file \(1\)[\s\S]*- `CLAUDE\.md`/);
		assert.match(out, /Claude Code reads CLAUDE\.md and skips AGENTS\.md/);
		assert.match(out, /\.claude\/rules\/local\.md/);
		assert.match(out, /Nothing is merged automatically/);
	});

	test("no report text sends the user to ShardMind or to obsidian-mind", () => {
		const all: UpgradeReport = { behind: ["a"], ahead: ["b"], merged: ["c"], conflicts: ["d"], added: ["e"], move: ["CLAUDE.md"], unchanged: 1 };
		assert.doesNotMatch(formatUpgradeReport(all, "v1.0.0", "v1.1.0"), /shardmind|obsidian-mind/i);
	});
});

describe("upgrade-plan.ts against real repos", () => {
	const script = join(dirname(fileURLToPath(import.meta.url)), "../upgrade-plan.ts");
	const git = (cwd: string, ...args: string[]) => {
		const r = spawnSync("git", ["-c", "user.name=t", "-c", "user.email=t@example.com", "-c", "commit.gpgsign=false", ...args], { cwd, encoding: "utf8" });
		assert.equal(r.status, 0, `git ${args.join(" ")}: ${r.stderr}`);
		return r.stdout;
	};
	const put = (dir: string, rel: string, text: string) => {
		mkdirSync(dirname(join(dir, rel)), { recursive: true });
		writeFileSync(join(dir, rel), text);
	};
	const manifest = (v: string) => JSON.stringify({ template: "glad-brain", version: v }) + "\n";

	function fixture(): { root: string; template: string; vault: string } {
		const root = mkdtempSync(join(tmpdir(), "gb-upgrade-"));
		const template = join(root, "template");
		const vault = join(root, "vault");
		mkdirSync(template);
		git(template, "init", "-q", "-b", "main");
		put(template, "vault-manifest.json", manifest("1.0.0"));
		put(template, "AGENTS.md", "# Glad Brain\n\nrule one\n");
		put(template, "README.md", "readme\n");
		put(template, "CHANGELOG.md", "# Changelog\n");
		put(template, "templates/Note.md", "a\nb\nc\nd\ne\nf\n");
		git(template, "add", "-A");
		git(template, "commit", "-q", "-m", "chore: first");
		git(root, "clone", "-q", template, vault);
		git(vault, "remote", "rename", "origin", "template");
		return { root, template, vault };
	}

	const plan = (vault: string, ...extra: string[]) => {
		const r = spawnSync(process.execPath, ["--experimental-strip-types", script, "--json", ...extra], { cwd: vault, encoding: "utf8", env: { ...process.env, CLAUDE_PROJECT_DIR: vault } });
		return { status: r.status, stdout: r.stdout, stderr: r.stderr };
	};

	test("sorts a real template update into behind, ahead, merged, conflicts and added", () => {
		const { root, template, vault } = fixture();
		try {
			// The vault: edits AGENTS.md (conflicts), README.md (ahead), templates/Note.md line a (merges), and has its own notes.
			put(vault, "AGENTS.md", "# Glad Brain\n\nmy rule\n");
			put(vault, "README.md", "my readme\n");
			put(vault, "templates/Note.md", "A\nb\nc\nd\ne\nf\n");
			put(vault, "work/active/site/next.md", "plan\n");
			git(vault, "add", "-A");
			git(vault, "commit", "-q", "-m", "chore: my edits");
			// The template: changes AGENTS.md (conflicts), CHANGELOG.md (behind), templates/Note.md line f (merges), adds a file.
			put(template, "AGENTS.md", "# Glad Brain\n\ntheir rule\n");
			put(template, "CHANGELOG.md", "# Changelog\n\n## v1.1.0\n");
			put(template, "templates/Note.md", "a\nb\nc\nd\ne\nF\n");
			put(template, "bin/new-tool", "x\n");
			put(template, "vault-manifest.json", manifest("1.1.0"));
			git(template, "add", "-A");
			git(template, "commit", "-q", "-m", "feat: update");

			const r = plan(vault);
			assert.equal(r.status, 0, r.stderr);
			const out = JSON.parse(r.stdout) as { from: string; to: string; report: UpgradeReport };
			assert.equal(out.from, "1.0.0");
			assert.equal(out.to, "1.1.0");
			assert.deepEqual(out.report.behind, ["CHANGELOG.md", "vault-manifest.json"]);
			assert.deepEqual(out.report.ahead, ["README.md"]);
			assert.deepEqual(out.report.merged, ["templates/Note.md"]);
			assert.deepEqual(out.report.conflicts, ["AGENTS.md"]);
			assert.deepEqual(out.report.added, ["bin/new-tool"]);
			// It only reads: the vault is where it was, and nothing was merged.
			assert.equal(git(vault, "log", "--oneline").trim().split("\n").length, 2);
			assert.equal(git(vault, "status", "--porcelain").trim(), "");
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});

	test("a vault with no `template` remote is told how to add it", () => {
		const { root, vault } = fixture();
		try {
			git(vault, "remote", "rename", "template", "origin");
			const r = plan(vault);
			assert.notEqual(r.status, 0);
			assert.match(r.stderr, /git remote add template https:\/\/github\.com\/Gladiarn\/glad-brain-template\.git/);
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});

	test("a vault whose history shares nothing with the template says the pull cannot work", () => {
		const { root, vault } = fixture();
		try {
			const other = join(root, "other");
			mkdirSync(other);
			git(other, "init", "-q", "-b", "main");
			put(other, "x.md", "x\n");
			git(other, "add", "-A");
			git(other, "commit", "-q", "-m", "chore: unrelated");
			git(vault, "remote", "set-url", "template", other);
			const r = plan(vault);
			assert.notEqual(r.status, 0);
			assert.match(r.stderr, /no common history/);
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});

	test("a vault with uncommitted changes is warned before the pull", () => {
		const { root, vault } = fixture();
		try {
			put(vault, "README.md", "dirty\n");
			const r = plan(vault);
			assert.equal(r.status, 0, r.stderr);
			assert.match(r.stderr, /uncommitted changes/);
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});
});
