/**
 * What the brain adds to a session's first context.
 *
 * In a linked code repo, reached through bin/brain-hook, that is all the
 * session gets from the vault: the project's plan for today, and any warning.
 * In the vault itself the same blocks join the vault's own context.
 */

import { existsSync, realpathSync } from "node:fs";
import { join, sep } from "node:path";
import { resolveProject, type ResolvedProject } from "./project.ts";
import { pull, type PullResult } from "./sync.ts";
import { todayContext } from "./today.ts";
import { transcriptsDirFor, unsavedReminder } from "./unsaved.ts";

const PROJECT_DIR_VARS = ["CLAUDE_PROJECT_DIR", "CODEX_PROJECT_DIR", "GEMINI_PROJECT_DIR"] as const;

/** The folder the agent says the session started in, else the working directory. */
export function sessionProjectDir(env: NodeJS.ProcessEnv, cwd: string): string {
	for (const name of PROJECT_DIR_VARS) {
		const v = env[name];
		if (v !== undefined && v !== "") return v;
	}
	return cwd;
}

const real = (p: string): string => {
	try {
		return realpathSync(p);
	} catch {
		return p;
	}
};

export function isInsideVault(dir: string, vaultRoot: string): boolean {
	const d = real(dir);
	const v = real(vaultRoot);
	return d === v || d.startsWith(v + sep);
}

/** A warning block when the pull did not finish cleanly; nothing when it did. */
export function syncBlock(result: PullResult): string | null {
	return result.ok ? null : `### Brain sync\n${result.warning}`;
}

/** The blocks to inject for `project`, each opening with its own `###` header. */
export function brainSessionBlocks(opts: {
	vaultRoot: string;
	project: ResolvedProject;
	sync?: PullResult;
	/** The folder the session started in and its id, to find the earlier sessions' transcripts. */
	session?: { dir: string; id: string | null };
}): string[] {
	const blocks: string[] = [];
	const warning = opts.sync === undefined ? null : syncBlock(opts.sync);
	if (warning !== null) blocks.push(warning);
	blocks.push(todayContext(opts.vaultRoot, opts.project));
	if (opts.session !== undefined) {
		const reminder = unsavedReminder(opts.vaultRoot, opts.project.name, transcriptsDirFor(opts.session.dir), opts.session.id);
		if (reminder !== null) blocks.push(reminder);
	}
	return blocks;
}

/**
 * The whole context for a session in a code repo, or null when the repo is
 * not linked (then the brain stays out of the way entirely).
 */
export function repoSessionContext(
	vaultRoot: string,
	sessionDir: string,
	opts: { pull: boolean; sessionId?: string | null } = { pull: true },
): string | null {
	if (isInsideVault(sessionDir, vaultRoot)) return null;
	// Pulled before the project is resolved: the other PC may have just linked this repo.
	const sync = opts.pull ? pull(vaultRoot) : undefined;
	const project = resolveProject(sessionDir, vaultRoot);
	if (project === null) return null;
	const blocks = brainSessionBlocks({
		vaultRoot,
		project,
		...(sync === undefined ? {} : { sync }),
		session: { dir: sessionDir, id: opts.sessionId ?? null },
	});
	return ["## Second Brain", ...blocks].join("\n\n");
}

/** For the vault's own session: the sync warning, and the plan block when the general plan exists. */
export function vaultSessionBlocks(vaultRoot: string, sync?: PullResult, sessionId: string | null = null): string[] {
	const project = resolveProject(vaultRoot, vaultRoot);
	if (project === null) return [];
	if (!existsSync(join(project.dir, "next.md"))) {
		const warning = sync === undefined ? null : syncBlock(sync);
		return warning === null ? [] : [warning];
	}
	return brainSessionBlocks({
		vaultRoot,
		project,
		...(sync === undefined ? {} : { sync }),
		session: { dir: vaultRoot, id: sessionId },
	});
}
