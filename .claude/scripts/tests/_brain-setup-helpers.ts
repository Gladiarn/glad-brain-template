/**
 * A throwaway "template clone" and a throwaway HOME for running setup.sh
 * without touching the real machine: the scripts under test are the repo's
 * own, linked in, and every external tool is a fake on a controlled PATH.
 */

import { spawnSync } from "node:child_process";
import { chmodSync, cpSync, existsSync, mkdirSync, readFileSync, symlinkSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { GIT_ENV, REPO_ROOT, git, tempDir, whichBin } from "./_brain-helpers.ts";

export const FAKE_KEY = "AIzaFAKEFAKEFAKEFAKEFAKEFAKEFAKEFAKEFAKE";

/** Write an executable script. */
export function script(path: string, body: string): void {
	writeFileSync(path, `#!/bin/sh\n${body}\n`);
	chmodSync(path, 0o755);
}

/**
 * A vault folder that looks like a fresh clone of the template: setup.sh, the
 * bin scripts and the templates are copies, `.claude` is a link to the real
 * scripts (kept out of git), and `.scripts/qmd-bootstrap.ts` is a fake that
 * logs its call. `log` holds the fakes' output.
 */
export function makeTemplateClone(parent: string, opts: { bootstrapExit?: number } = {}): string {
	const clone = join(parent, "brain");
	mkdirSync(clone, { recursive: true });
	git(clone, "init", "-q", "-b", "main");
	cpSync(join(REPO_ROOT, "setup.sh"), join(clone, "setup.sh"));
	chmodSync(join(clone, "setup.sh"), 0o755);
	cpSync(join(REPO_ROOT, "bin"), join(clone, "bin"), { recursive: true });
	for (const f of ["brain.config.json", "projects.map.json", ".gitignore", "vault-manifest.json"]) {
		cpSync(join(REPO_ROOT, f), join(clone, f));
	}
	cpSync(join(REPO_ROOT, "templates"), join(clone, "templates"), { recursive: true });
	mkdirSync(join(clone, "work", "active"), { recursive: true });
	writeFileSync(join(clone, "work", "Index.md"), "# Work Notes\n\n## Active Projects\n\n-\n");
	symlinkSync(join(REPO_ROOT, ".claude"), join(clone, ".claude"));
	writeFileSync(join(clone, ".git", "info", "exclude"), ".claude\n");
	mkdirSync(join(clone, ".scripts"));
	writeFileSync(
		join(clone, ".scripts", "qmd-bootstrap.ts"),
		`import { appendFileSync } from "node:fs";\nappendFileSync(${JSON.stringify(join(parent, "qmd-bootstrap.log"))}, "ran\\n");\nprocess.exit(${opts.bootstrapExit ?? 0});\n`,
	);
	return clone;
}

/** Fake `uv`, `graphify`, `claude`, `npm` (each logging its argv) and a symlink to the real git. */
export function makeFakeTools(dir: string, which: { claude?: boolean; uv?: boolean; graphify?: boolean; npm?: boolean } = {}): void {
	mkdirSync(dir, { recursive: true });
	const realGit = whichBin("git");
	if (realGit === null) throw new Error("git is required");
	symlinkSync(realGit, join(dir, "git"));
	const fake = (name: string) => script(join(dir, name), `printf '%s\\n' "$*" >> "${join(dir, `${name}.log`)}"\nexit 0`);
	if (which.uv !== false) fake("uv");
	if (which.graphify !== false) fake("graphify");
	if (which.claude !== false) fake("claude");
	if (which.npm !== false) fake("npm");
}

export type SetupResult = { stdout: string; stderr: string; code: number };

export function runSetup(opts: {
	clone: string;
	home: string;
	tools: string;
	args?: string[];
	input?: string;
	env?: Record<string, string>;
	procVersion?: string;
}): SetupResult {
	const procVersion = join(opts.home, "proc-version");
	writeFileSync(procVersion, opts.procVersion ?? "Linux version 6.0.0-microsoft-standard-WSL2\n");
	const r = spawnSync("bash", [join(opts.clone, "setup.sh"), ...(opts.args ?? ["--non-interactive", "--no-qmd", "--no-install"])], {
		cwd: opts.clone,
		input: opts.input ?? `${FAKE_KEY}\n`,
		encoding: "utf8",
		windowsHide: true,
		timeout: 60_000,
		env: {
			...GIT_ENV,
			HOME: opts.home,
			PATH: `${opts.tools}:${dirname(process.execPath)}:/usr/bin:/bin`,
			BRAIN_PROC_VERSION: procVersion,
			WSL_DISTRO_NAME: "Ubuntu-Test",
			USER: "tester",
			...opts.env,
		},
	});
	return { stdout: r.stdout ?? "", stderr: r.stderr ?? "", code: r.status ?? -1 };
}

export const readLog = (dir: string, name: string): string[] => {
	const f = join(dir, `${name}.log`);
	return existsSync(f)
		? readFileSync(f, "utf8")
				.split("\n")
				.filter((l) => l !== "")
		: [];
};

export { tempDir };
