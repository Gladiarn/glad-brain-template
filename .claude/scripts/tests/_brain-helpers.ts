/**
 * Shared helpers for the brain tests: throwaway vaults, git repos, and a
 * `git` that works without a user identity on the machine.
 */

import { spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, mkdtempSync, realpathSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/** The real vault the tests run from: its templates and scripts are the fixtures. */
export const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");

/** Env for a git subprocess: an identity, and no global config leaking in. */
export const GIT_ENV: NodeJS.ProcessEnv = {
	...process.env,
	GIT_AUTHOR_NAME: "Test",
	GIT_AUTHOR_EMAIL: "test@example.com",
	GIT_COMMITTER_NAME: "Test",
	GIT_COMMITTER_EMAIL: "test@example.com",
	GIT_TERMINAL_PROMPT: "0",
};

export function git(cwd: string, ...args: string[]): string {
	const r = spawnSync("git", args, { cwd, encoding: "utf8", env: GIT_ENV, windowsHide: true });
	if (r.status !== 0) throw new Error(`git ${args.join(" ")} failed: ${r.stderr}`);
	return r.stdout;
}

/** A temp dir, resolved through realpath so path comparisons survive symlinked tmp roots. */
export function tempDir(prefix: string): string {
	return realpathSync(mkdtempSync(join(tmpdir(), prefix)));
}

/** A minimal vault: `work/active/`, a work index, and the real note templates. */
export function makeVault(): string {
	const vault = tempDir("brain-vault-");
	mkdirSync(join(vault, "work", "active"), { recursive: true });
	writeFileSync(join(vault, "work", "Index.md"), "# Work Notes\n\n## Active Projects\n\n-\n");
	const templates = join(REPO_ROOT, "templates");
	if (existsSync(templates)) cpSync(templates, join(vault, "templates"), { recursive: true });
	return vault;
}

/** A git repo, optionally with an origin remote (never contacted). */
export function makeRepo(name: string, remote?: string): string {
	const parent = tempDir("brain-repo-");
	const repo = join(parent, name);
	mkdirSync(repo, { recursive: true });
	git(repo, "init", "-q");
	if (remote !== undefined) git(repo, "remote", "add", "origin", remote);
	return repo;
}

import { chmodSync, symlinkSync } from "node:fs";

export const BRAIN_CLI = join(REPO_ROOT, ".claude", "scripts", "brain.ts");

/** The absolute path of a binary on the real PATH, or null. */
export function whichBin(name: string): string | null {
	const r = spawnSync("sh", ["-c", `command -v ${name}`], { encoding: "utf8", windowsHide: true });
	const p = r.stdout.trim();
	return r.status === 0 && p !== "" ? p : null;
}

/**
 * A bin dir holding only `git` (symlinked from the real one) plus whatever
 * fake scripts the test names, so a test controls exactly what is on PATH.
 * Each fake appends its argv, one line per call, to `<dir>/<name>.log` and
 * exits with `exit` (default 0).
 */
export function makeBin(fakes: Record<string, { exit?: number; extra?: string }> = {}): string {
	const dir = tempDir("brain-bin-");
	const realGit = whichBin("git");
	if (realGit === null) throw new Error("git is required for the brain tests");
	symlinkSync(realGit, join(dir, "git"));
	for (const [name, opts] of Object.entries(fakes)) {
		const script = `#!/bin/sh\nprintf '%s\\n' "$*" >> "${join(dir, `${name}.log`)}"\n${opts.extra ?? ""}\nexit ${opts.exit ?? 0}\n`;
		writeFileSync(join(dir, name), script);
		chmodSync(join(dir, name), 0o755);
	}
	return dir;
}

export type CliResult = { stdout: string; stderr: string; code: number };

/** Run `brain.ts <args>` the way bin/brain does, against a temp vault and a controlled PATH. */
export function runBrain(
	args: string[],
	opts: { vault: string; cwd: string; binDir: string; env?: Record<string, string>; input?: string },
): CliResult {
	const r = spawnSync(
		process.execPath,
		["--disable-warning=ExperimentalWarning", "--experimental-strip-types", BRAIN_CLI, ...args],
		{
			cwd: opts.cwd,
			encoding: "utf8",
			windowsHide: true,
			timeout: 30_000,
			input: opts.input ?? "",
			env: {
				...GIT_ENV,
				PATH: opts.binDir,
				BRAIN_VAULT: opts.vault,
				GEMINI_API_KEY: "",
				// Never this PC's real key, even when a test file runs on its own.
				BRAIN_ENV_FILE: join(tmpdir(), "brain-test-no-env-file"),
				...opts.env,
			},
		},
	);
	return { stdout: r.stdout ?? "", stderr: r.stderr ?? "", code: r.status ?? -1 };
}

/**
 * The brain CLI, its hooks and setup.sh target WSL and Linux (bash, POSIX
 * paths, fake tools as shell scripts). On native Windows these suites skip.
 */
export const WSL_ONLY: string | false = process.platform === "win32" ? "the brain CLI targets WSL and Linux" : false;
