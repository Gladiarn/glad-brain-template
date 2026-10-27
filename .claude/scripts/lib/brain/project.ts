/**
 * Which vault project a working directory belongs to.
 *
 * A session inside the vault is the `general` project. A session in a code
 * repo is looked up in `projects.map.json`, first by the repo's git remote
 * (so the same entry works on both PCs whatever the local path), then by
 * exact path for a repo that has no remote. No file is ever written into
 * the code repo.
 */

import { spawnSync } from "node:child_process";
import { readFileSync, realpathSync } from "node:fs";
import { join, sep } from "node:path";

export type ResolvedProject = {
	name: string;
	dir: string;
	client: string | null;
	source: "remote" | "path" | "vault";
};

export const MAP_FILE = "projects.map.json";
export const GENERAL_PROJECT = "general";
const GIT_TIMEOUT_MS = 2000;

/** A project name becomes a folder name under `work/active/`, so it must not be able to leave it. */
export function isValidProjectName(name: string): boolean {
	return /^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(name) && !name.includes("..");
}

/**
 * `git@github.com:Me/Site.git` and `https://github.com/me/site` are the same
 * repo. Credentials in a url are dropped so a token can never reach the map.
 */
export function normalizeRemote(url: string): string {
	let u = url.trim();
	const scp = /^[^@/\s]+@([^:/\s]+):(?!\/)(.+)$/.exec(u);
	if (scp) {
		u = `${scp[1]}/${scp[2]}`;
	} else {
		u = u.replace(/^[a-z][a-z0-9+.-]*:\/\//i, "");
		u = u.replace(/^[^@/]*@/, "");
		u = u.replace(/^([^/:]+):\d+(?=\/)/, "$1");
	}
	u = u.replace(/\/+$/, "").replace(/\.git$/i, "").replace(/\/+$/, "");
	return u.toLowerCase();
}

function real(p: string): string {
	try {
		return realpathSync(p);
	} catch {
		return p;
	}
}

function gitOut(cwd: string, args: string[]): string | null {
	const r = spawnSync("git", ["-C", cwd, ...args], { encoding: "utf8", timeout: GIT_TIMEOUT_MS, windowsHide: true });
	if (r.error || r.status !== 0) return null;
	const out = r.stdout.trim();
	return out === "" ? null : out;
}

export type MapEntry = { project: string; client: string | null };

/**
 * The map keys a repo can be found under: its normalized origin remote (null
 * when it has none) and its absolute path. Link writes the first that exists;
 * resolve tries both.
 */
export function repoKeys(repoPath: string): { remote: string | null; path: string } {
	const here = real(repoPath);
	const remote = gitOut(here, ["remote", "get-url", "origin"]);
	const top = gitOut(here, ["rev-parse", "--show-toplevel"]);
	return { remote: remote === null ? null : normalizeRemote(remote), path: `path:${real(top ?? here)}` };
}

export function readMap(vaultRoot: string): Map<string, MapEntry> {
	const out = new Map<string, MapEntry>();
	let raw: unknown;
	try {
		raw = JSON.parse(readFileSync(join(vaultRoot, MAP_FILE), "utf8"));
	} catch {
		return out;
	}
	const projects = (raw as { projects?: unknown } | null)?.projects;
	if (typeof projects !== "object" || projects === null) return out;
	for (const [key, value] of Object.entries(projects)) {
		const v = value as { project?: unknown; client?: unknown } | null;
		if (typeof v?.project !== "string" || !isValidProjectName(v.project)) continue;
		const client = typeof v.client === "string" && v.client !== "" ? v.client : null;
		out.set(key, { project: v.project, client });
	}
	return out;
}

export function resolveProject(cwd: string, vaultRoot: string): ResolvedProject | null {
	const vault = real(vaultRoot);
	const here = real(cwd);
	const dirFor = (name: string) => join(vault, "work", "active", name);

	if (here === vault || here.startsWith(vault + sep)) {
		return { name: GENERAL_PROJECT, dir: dirFor(GENERAL_PROJECT), client: null, source: "vault" };
	}

	const map = readMap(vault);
	if (map.size === 0) return null;

	const keys = repoKeys(here);
	const byRemote = keys.remote === null ? undefined : map.get(keys.remote);
	if (byRemote) {
		return { name: byRemote.project, dir: dirFor(byRemote.project), client: byRemote.client, source: "remote" };
	}

	const hit = map.get(keys.path);
	if (hit) return { name: hit.project, dir: dirFor(hit.project), client: hit.client, source: "path" };
	return null;
}

/** The client the map records for a project name, or null. First entry wins. */
export function clientForProject(vaultRoot: string, project: string): string | null {
	for (const entry of readMap(vaultRoot).values()) {
		if (entry.project === project) return entry.client;
	}
	return null;
}

/** A client name becomes `clients/<name>.md`, so it must be a plain file stem. */
export function isSafeFileStem(name: string): boolean {
	return /^[A-Za-z0-9][A-Za-z0-9 ._&'-]*$/.test(name) && !name.includes("..") && !/[ .]$/.test(name);
}
