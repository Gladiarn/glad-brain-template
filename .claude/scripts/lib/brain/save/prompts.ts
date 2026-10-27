/**
 * The three prompts of a save: write, check, fix. Everything the model sees
 * goes in as one JSON document, so the summary and the notes are data and
 * never part of the instructions.
 */

import type { SaveSummary } from "./schema.ts";

export type FileView = { path: string; exists: boolean; content: string };
export type ProposedFile = { path: string; content: string };

const FILING_RULES = `You file a web developer's coding-session summary into their markdown notes vault. Answer with JSON only, in exactly this shape: {"files":[{"path":string,"content":string}]}.

Rules:
- Write only to paths listed in allowedPaths. Any other path makes the whole save be thrown away.
- For each file you change, return its COMPLETE new content. Leave out files that need no change.
- Keep every file's frontmatter exactly as it is.
- work/active/<project>/next.md is the current plan. Rewrite it in place so it reads as the state right now: What To Do Next in order, Completed, Blocked, Key Context, Success Criteria. Never add a second copy of a section. Move finished steps into Completed.
- tasks.md: move done tasks to Done, add new tasks to Open, never duplicate a task.
- decisions.md: one entry per decision with its title and why. Create it only when there is a decision.
- brain/Gotchas.md, brain/Patterns.md, brain/Key Decisions.md: add each lesson as one bullet under the matching note. Do not remove or reword existing entries.
- work/Index.md: touch only this project's own line, if at all.
- clients/<client>.md: add the clientNote as one dated bullet under Notes.
- Never delete existing content, except by rewriting next.md. Do not invent anything: use only the summary and the files you were given. Do not repeat what a file already says.
- Write each paragraph on a single line. Keep the existing note style.
- Never write an API key, token or password.`;

const CHECK_RULES = `You review a filing of a coding-session summary into a markdown notes vault. You get the summary, the old files and the new files. Answer with JSON only, in exactly this shape: {"ok":boolean,"problems":string[]}.

Set ok to false when any of these is true, and name each problem in one short sentence that names the file:
- lost content: something in an old file is missing from its new version without a reason in the summary
- invented facts: something in a new file is supported by neither the summary nor the old files
- duplicates: the same fact, task or section appears twice
- wrong project or wrong file: content that belongs to another project, or is filed where it does not belong
- a file lost its frontmatter or a section heading
- a secret (API key, token, password) appears anywhere

Otherwise set ok to true and problems to an empty array.`;

function describeSummary(summary: SaveSummary, today: string): Record<string, unknown> {
	return { project: summary.project, kind: summary.kind, today, summary };
}

export function writePrompt(summary: SaveSummary, allowedPaths: string[], files: FileView[], today: string) {
	const itemNote =
		summary.kind === "item"
			? "\nThis is an item save: file only summary.itemText, and leave everything else in the files as it is, except where that item changes it."
			: "";
	return {
		system: FILING_RULES + itemNote,
		user: JSON.stringify({ ...describeSummary(summary, today), allowedPaths, files }),
	};
}

export function checkPrompt(summary: SaveSummary, old: FileView[], next: ProposedFile[], today: string) {
	return {
		system: CHECK_RULES,
		user: JSON.stringify({ ...describeSummary(summary, today), oldFiles: old, newFiles: next }),
	};
}

export function fixPrompt(
	summary: SaveSummary,
	allowedPaths: string[],
	old: FileView[],
	previous: ProposedFile[],
	problems: string[],
	today: string,
) {
	return {
		system: `${FILING_RULES}\n\nA reviewer found problems with your previous answer. Return the corrected complete answer in the same shape, fixing every problem and changing nothing else.`,
		user: JSON.stringify({ ...describeSummary(summary, today), allowedPaths, files: old, previousAnswer: previous, problems }),
	};
}
