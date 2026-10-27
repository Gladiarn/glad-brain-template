/**
 * The files the brain ships with: project templates, the `general` project,
 * the empty project map and the default config. A template or seed note that
 * fails the vault's own frontmatter rules would warn on every first write.
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { validateContent, parseFrontmatterRequired } from "../lib/frontmatter.ts";
import { loadConfig } from "../lib/brain/config.ts";
import { REPO_ROOT } from "./_brain-helpers.ts";

const read = (rel: string) => readFileSync(join(REPO_ROOT, rel), "utf8");
const manifest = JSON.parse(read("vault-manifest.json")) as Record<string, unknown>;
const required = parseFrontmatterRequired(manifest);

describe("project templates", () => {
	const templates = ["Project Next.md", "Project Tasks.md", "Session.md", "Decision.md"];

	test("all four templates exist and open with frontmatter", () => {
		for (const t of templates) {
			assert.ok(existsSync(join(REPO_ROOT, "templates", t)), `${t} is missing`);
			assert.ok(read(`templates/${t}`).startsWith("---\n"), `${t} has no frontmatter`);
		}
	});

	test("Project Next carries the current-plan sections", () => {
		const next = read("templates/Project Next.md");
		for (const h of ["What To Do Next", "Completed", "Blocked", "Key Context", "Success Criteria"]) {
			assert.match(next, new RegExp(`^## ${h}$`, "m"), `missing ## ${h}`);
		}
	});

	test("Project Next and Tasks hold the fields a work/active note needs, with substitutable placeholders", () => {
		for (const t of ["Project Next.md", "Project Tasks.md"]) {
			const text = read(`templates/${t}`);
			for (const key of ["date:", "status: active", "quarter:", "description:", "tags:"]) {
				assert.ok(text.includes(key), `${t} lacks ${key}`);
			}
			assert.ok(text.includes("{{title}}") && text.includes("{{date}}"), `${t} lacks placeholders`);
		}
	});

	test("Project Tasks has Open and Done sections", () => {
		const tasks = read("templates/Project Tasks.md");
		assert.match(tasks, /^## Open$/m);
		assert.match(tasks, /^## Done$/m);
	});
});

describe("the general project", () => {
	test("next.md and tasks.md exist and pass the work-note frontmatter rules", () => {
		for (const f of ["next.md", "tasks.md"]) {
			const rel = `work/active/general/${f}`;
			assert.ok(existsSync(join(REPO_ROOT, rel)), `${rel} is missing`);
			assert.deepEqual(validateContent(read(rel), { required, relPath: rel }), [], rel);
		}
	});

	test("next.md has a What To Do Next section", () => {
		assert.match(read("work/active/general/next.md"), /^## What To Do Next$/m);
	});

	test("work/Index.md lists the general project", () => {
		assert.match(read("work/Index.md"), /\[\[work\/active\/general\/next\|general\]\]/);
	});
});

describe("shipped data files", () => {
	test("projects.map.json starts empty", () => {
		assert.deepEqual(JSON.parse(read("projects.map.json")), { projects: {} });
	});

	test("brain.config.json holds the defaults", () => {
		const onDisk = JSON.parse(read("brain.config.json")) as Record<string, unknown>;
		assert.deepEqual(onDisk, { ...loadConfig(join(REPO_ROOT, "nonexistent")) });
		assert.deepEqual(loadConfig(REPO_ROOT), onDisk);
	});
});
