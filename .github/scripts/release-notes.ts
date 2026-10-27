#!/usr/bin/env node
/**
 * Print the CHANGELOG.md section for a release tag, for use as the GitHub
 * release notes.
 *
 *   release-notes.ts <tag> [changelog-path]
 *
 * Exits 1 when the changelog has no section for the tag, so a release cannot
 * go out with empty notes.
 */

import { readFileSync } from "node:fs";

import { isMainModule } from "../../.claude/scripts/lib/main-guard.ts";
import { escapeRegex } from "../../.claude/scripts/lib/regex.ts";

/**
 * The body of the `## vX.Y.Z — date` section for `version` (a leading `v` is
 * optional): everything under its heading up to the next `## ` heading, a
 * closing footer line, or the end. Throws when there is no such section.
 */
export function releaseNotes(changelog: string, version: string): string {
	const v = version.replace(/^v/, "");
	const heading = new RegExp(`^## v${escapeRegex(v)} — .*$`, "m").exec(changelog);
	if (!heading) throw new Error(`CHANGELOG.md has no section for v${v}`);
	const rest = changelog.slice(heading.index + heading[0].length);
	// Same boundary as generate-changelog.ts: the next heading, or a blank line followed by plain text.
	const end = /\n## [^\n]|\n\n+[^\s#-]/.exec(rest);
	return (end ? rest.slice(0, end.index) : rest).trim();
}

function main(argv: string[]): number {
	const [tag, path = "CHANGELOG.md"] = argv;
	if (tag === undefined) {
		console.error("usage: release-notes.ts <tag> [changelog-path]");
		return 2;
	}
	try {
		process.stdout.write(`${releaseNotes(readFileSync(path, "utf8"), tag)}\n`);
		return 0;
	} catch (e) {
		console.error(`release-notes: ${(e as Error).message}`);
		return 1;
	}
}

if (isMainModule(import.meta.url)) process.exit(main(process.argv.slice(2)));
