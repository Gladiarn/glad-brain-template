/**
 * Tests for project resolution: remote normalization, and how a working
 * directory maps to a vault project (vault, remote, path, or nothing).
 */

import { test, describe, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { normalizeRemote, resolveProject } from "../lib/brain/project.ts";
import { rmTemp } from "./_helpers.ts";
import { makeRepo, makeVault, WSL_ONLY } from "./_brain-helpers.ts";

describe("normalizeRemote", { skip: WSL_ONLY }, () => {
	test("the scp-style and https forms of one repo are equal", () => {
		const a = normalizeRemote("git@github.com:Me/Site.git");
		const b = normalizeRemote("https://github.com/me/site");
		assert.equal(a, "github.com/me/site");
		assert.equal(a, b);
	});

	test("ssh:// urls with a port and a .git suffix normalize to host/path", () => {
		assert.equal(normalizeRemote("ssh://git@example.com:2222/Team/Repo.git"), "example.com/team/repo");
	});

	test("credentials in an https url are dropped, never kept in the key", () => {
		const key = normalizeRemote("https://user:ghp_FAKEFAKEFAKE@github.com/Me/Site.git");
		assert.equal(key, "github.com/me/site");
		assert.ok(!key.includes("ghp_"));
	});

	test("trailing slashes and surrounding whitespace are ignored", () => {
		assert.equal(normalizeRemote("  https://github.com/me/site/\n"), "github.com/me/site");
	});
});

describe("resolveProject", { skip: WSL_ONLY }, () => {
	let vault: string;
	const cleanup: string[] = [];
	const writeMap = (projects: Record<string, { project: string; client: string | null }>) =>
		writeFileSync(join(vault, "projects.map.json"), JSON.stringify({ projects }));

	beforeEach(() => {
		vault = makeVault();
		writeMap({});
	});
	afterEach(() => {
		rmTemp(vault);
		for (const d of cleanup.splice(0)) rmTemp(d);
	});

	test("a cwd inside the vault is the general project", () => {
		const inside = join(vault, "work", "active");
		const p = resolveProject(inside, vault);
		assert.deepEqual(p, {
			name: "general",
			dir: join(vault, "work", "active", "general"),
			client: null,
			source: "vault",
		});
	});

	test("the vault root itself is the general project", () => {
		assert.equal(resolveProject(vault, vault)?.source, "vault");
	});

	test("a linked repo with a remote resolves by remote, from any path", () => {
		writeMap({ "github.com/me/site": { project: "client-site", client: "acme" } });
		const first = makeRepo("site", "git@github.com:Me/Site.git");
		const second = makeRepo("elsewhere-checkout", "https://github.com/me/site");
		cleanup.push(first, second);
		for (const repo of [first, second]) {
			const p = resolveProject(repo, vault);
			assert.deepEqual(p, {
				name: "client-site",
				dir: join(vault, "work", "active", "client-site"),
				client: "acme",
				source: "remote",
			});
		}
	});

	test("a subfolder of a linked repo resolves to the same project", () => {
		writeMap({ "github.com/me/site": { project: "client-site", client: null } });
		const repo = makeRepo("site", "git@github.com:me/site.git");
		cleanup.push(repo);
		const sub = join(repo, "src", "components");
		mkdirSync(sub, { recursive: true });
		assert.equal(resolveProject(sub, vault)?.name, "client-site");
	});

	test("a repo with no remote resolves only by its exact path entry", () => {
		const repo = makeRepo("local-only");
		cleanup.push(repo);
		assert.equal(resolveProject(repo, vault), null);
		writeMap({ [`path:${repo}`]: { project: "local-thing", client: null } });
		const p = resolveProject(repo, vault);
		assert.equal(p?.name, "local-thing");
		assert.equal(p?.source, "path");
	});

	test("a path entry for another folder does not match", () => {
		const repo = makeRepo("local-only");
		cleanup.push(repo);
		writeMap({ [`path:${repo}-other`]: { project: "x", client: null } });
		assert.equal(resolveProject(repo, vault), null);
	});

	test("an unlinked repo gives null", () => {
		const repo = makeRepo("stranger", "git@github.com:me/stranger.git");
		cleanup.push(repo);
		assert.equal(resolveProject(repo, vault), null);
	});

	test("a folder that is not a git repo and is not linked gives null", () => {
		const repo = makeRepo("plain");
		cleanup.push(repo);
		const outside = join(repo, "..");
		assert.equal(resolveProject(outside, vault), null);
	});

	test("a missing or broken projects.map.json gives null for a repo", () => {
		const repo = makeRepo("site", "git@github.com:me/site.git");
		cleanup.push(repo);
		writeFileSync(join(vault, "projects.map.json"), "{ broken");
		assert.equal(resolveProject(repo, vault), null);
	});

	test("a map entry whose project name would escape work/active is ignored", () => {
		writeMap({ "github.com/me/site": { project: "../../etc", client: null } });
		const repo = makeRepo("site", "git@github.com:me/site.git");
		cleanup.push(repo);
		assert.equal(resolveProject(repo, vault), null);
	});
});
