/**
 * The README and the setup guide carry the steps a new owner follows. These
 * tests pin the headings and the commands, so a rewrite can not quietly lose
 * the two-repo flow.
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { REPO_ROOT, WSL_ONLY } from "./_brain-helpers.ts";

const read = (rel: string) => readFileSync(join(REPO_ROOT, rel), "utf8");
const section = (text: string, heading: string): string => {
	const m = new RegExp(`^## ${heading}\\s*$([\\s\\S]*?)(?=^## |(?![\\s\\S]))`, "m").exec(text);
	return m?.[1] ?? "";
};

describe("README", { skip: WSL_ONLY }, () => {
	const readme = read("README.md");

	test("introduces the template and links the credits", () => {
		assert.match(readme.split("\n").slice(0, 40).join("\n"), /Glad Brain/);
		assert.match(readme, /\(NOTICE\.md\)/);
		assert.match(readme, /obsidian-mind/);
	});

	test("Quick start: create the private brain, in order", () => {
		const s = section(readme, "Quick start");
		const order = ["git clone", "git remote rename origin template", "rm .template-repo", "--remote origin", "./setup.sh"];
		let at = -1;
		for (const cmd of order) {
			const i = s.indexOf(cmd);
			assert.ok(i > at, `"${cmd}" is missing or out of order`);
			at = i;
		}
		assert.match(s, /private/i);
	});

	test("Second PC: clone the brain and run setup", () => {
		const s = section(readme, "Quick start").split("Add another PC")[1] ?? "";
		assert.match(s, /git clone/);
		assert.match(s, /\.\/setup\.sh/);
	});

	test("Get template updates: pull from the template remote", () => {
		assert.match(section(readme, "Updating"), /git pull template main/);
	});

	test("the save trigger and brain link are explained", () => {
		assert.match(readme, /brain link/);
		assert.match(readme, /`save`/);
		assert.match(readme, /save:/);
	});
});

describe("docs/brain-setup.md", { skip: WSL_ONLY }, () => {
	const guide = read("docs/brain-setup.md");

	test("has the viewing section and the setup facts", () => {
		assert.match(guide, /^## Viewing your brain$/m);
		assert.match(guide, /\.env/);
		assert.match(guide, /GEMINI_API_KEY/);
		assert.match(guide, /\.wslconfig/);
		assert.match(guide, /brain link/);
	});

	test("never shows a real-looking key", () => {
		assert.ok(!/AIza[0-9A-Za-z_-]{35}/.test(guide));
		assert.ok(!/AIza[0-9A-Za-z_-]{35}/.test(read("README.md")));
	});
});
