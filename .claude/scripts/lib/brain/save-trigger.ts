/**
 * The `save` trigger. A message that is exactly `save` saves the session's
 * progress; one that starts with `save:` saves that single item. Anything
 * else that merely contains the word ("add a save button") is not a command.
 *
 * Detection lives here, in code the UserPromptSubmit hook calls, so it fires
 * the same way in a long session as in a short one. What the hook adds to the
 * context is the instruction below: Claude writes a summary and runs
 * `brain save`, and the CLI does the filing.
 */

import { join } from "node:path";
import { resolveProject, type ResolvedProject } from "./project.ts";

export type SaveCommand = { kind: "session" } | { kind: "item"; text: string };

export function parseSave(prompt: string): SaveCommand | null {
	const p = prompt.trim();
	if (/^save[.!]*$/i.test(p)) return { kind: "session" };
	const item = /^save:([\s\S]*)$/i.exec(p);
	if (item) {
		const text = item[1]!.trim();
		return text === "" ? { kind: "session" } : { kind: "item", text };
	}
	return null;
}

const brainCmd = (vaultRoot?: string): string => (vaultRoot === undefined ? "brain" : join(vaultRoot, "bin", "brain"));

export function saveInstruction(cmd: SaveCommand, project: ResolvedProject, vaultRoot?: string): string {
	const brain = brainCmd(vaultRoot);
	const who = `project \`${project.name}\`${project.client === null ? "" : ` (client: ${project.client})`}`;
	const shape = [
		"{",
		`  "project": "${project.name}",`,
		`  "kind": "${cmd.kind}",`,
		'  "done": ["what was finished this session"],',
		'  "addedTasks": ["new open tasks"],',
		'  "decisions": [{ "title": "short title", "why": "the reason" }],',
		'  "lessons": [{ "type": "gotcha | pattern | decision", "text": "what to remember" }],',
		'  "next": ["what to do next, in order"],',
		'  "blocked": ["what is blocked, and on what"]' + (cmd.kind === "item" ? "," : ""),
		...(cmd.kind === "item" ? ['  "itemText": "the user\'s exact text, below"'] : []),
		"}",
	].join("\n");
	const what =
		cmd.kind === "session"
			? `The user's message was exactly \`save\`. Save this session's progress for ${who}.`
			: `The user's message started with \`save:\`. Save that one item for ${who}, and nothing else from the session. File it in the field that fits (a decision goes in decisions, a gotcha or pattern in lessons, a task in addedTasks, anything else in next), leave the other fields empty, and set itemText to the exact text below.\n\nItem:\n${cmd.text}`;
	return [
		"## Save requested",
		what,
		"1. Write a short JSON summary to a temp file (for example one made with `mktemp --suffix=.json`) in this shape. Use only what happened in this conversation, and leave a field as an empty array when it has nothing. Never put an API key, token, password or other secret in it.",
		"```json\n" + shape + "\n```",
		`2. Run \`${brain} save --summary <that file>\` and follow its exit code:`,
		'   - `0`: Gemini filed it. Tell the user "saved via Gemini" and name the files it printed.',
		`   - \`3\`: Gemini could not, and nothing was written. Its output gives the reason and the exact files. Start one subagent with model "sonnet" to update only those files from your summary (keep \`next.md\` rewritten in place, never appended to; never touch another file), then run \`${brain} save --commit-only\` and tell the user "saved via Claude: <the reason>".`,
		"   - `4`: another session is saving. Tell the user \"save busy\" and to say `save` again in a moment.",
		"   - `1`: the summary was invalid; the message says why. Fix it and run the command once more.",
		"3. Do nothing else for this message unless the user also asked for something else.",
	].join("\n\n");
}

/** The context to inject for `prompt`, or null when it is not a save command. */
export function saveContext(prompt: string, vaultRoot: string, sessionDir: string): string | null {
	const cmd = parseSave(prompt);
	if (cmd === null) return null;
	const project = resolveProject(sessionDir, vaultRoot);
	if (project === null) {
		return [
			"## Save requested",
			`The user asked to save, but this folder is not linked to a vault project, so nothing was saved. Tell them to run \`${brainCmd(vaultRoot)} link\` in this repo (or to start the session in the vault for general notes), then say \`save\` again.`,
		].join("\n\n");
	}
	return saveInstruction(cmd, project, vaultRoot);
}
