/**
 * The save summary Claude writes, and the files a save may touch.
 *
 * `allowedTargets` is the whole write surface of a save: the project's own
 * folder, its line in the work index, the brain lessons, and the linked
 * client note. Anything a model proposes outside this list is refused, so a
 * bad answer can cost a fallback but never a stray file.
 */

import { clientForProject, isSafeFileStem, isValidProjectName } from "../project.ts";

export type LessonType = "gotcha" | "pattern" | "decision";

export type SaveSummary = {
	project: string;
	kind: "session" | "item";
	done: string[];
	addedTasks: string[];
	decisions: { title: string; why: string }[];
	lessons: { type: LessonType; text: string }[];
	next: string[];
	blocked: string[];
	clientNote?: string;
	itemText?: string;
};

export type ParsedSummary = { ok: true; summary: SaveSummary } | { ok: false; error: string };

const MAX_ITEMS = 100;
const MAX_TEXT = 4000;
const LESSON_TYPES: readonly string[] = ["gotcha", "pattern", "decision"];

const fail = (error: string): ParsedSummary => ({ ok: false, error });

function strings(value: unknown, field: string): string[] | string {
	if (value === undefined) return [];
	if (!Array.isArray(value)) return `${field} must be an array of strings`;
	if (value.length > MAX_ITEMS) return `${field} has more than ${MAX_ITEMS} items`;
	const out: string[] = [];
	for (const v of value) {
		if (typeof v !== "string") return `${field} must hold only strings`;
		if (v.length > MAX_TEXT) return `an item in ${field} is longer than ${MAX_TEXT} characters`;
		out.push(v.trim());
	}
	return out;
}

export function parseSummary(raw: unknown): ParsedSummary {
	if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return fail("the summary must be a JSON object");
	const o = raw as Record<string, unknown>;
	if (typeof o["project"] !== "string" || !isValidProjectName(o["project"])) return fail("project is missing or not a usable project name");
	if (o["kind"] !== "session" && o["kind"] !== "item") return fail('kind must be "session" or "item"');

	const lists: Record<"done" | "addedTasks" | "next" | "blocked", string[]> = { done: [], addedTasks: [], next: [], blocked: [] };
	for (const f of ["done", "addedTasks", "next", "blocked"] as const) {
		const r = strings(o[f], f);
		if (typeof r === "string") return fail(r);
		lists[f] = r;
	}

	const decisions: SaveSummary["decisions"] = [];
	if (o["decisions"] !== undefined) {
		if (!Array.isArray(o["decisions"]) || o["decisions"].length > MAX_ITEMS) return fail("decisions must be an array");
		for (const d of o["decisions"] as unknown[]) {
			const x = d as { title?: unknown; why?: unknown } | null;
			if (typeof x?.title !== "string" || typeof x.why !== "string") return fail("each decision needs a title and a why");
			if (x.title.length > MAX_TEXT || x.why.length > MAX_TEXT) return fail("a decision is too long");
			decisions.push({ title: x.title.trim(), why: x.why.trim() });
		}
	}

	const lessons: SaveSummary["lessons"] = [];
	if (o["lessons"] !== undefined) {
		if (!Array.isArray(o["lessons"]) || o["lessons"].length > MAX_ITEMS) return fail("lessons must be an array");
		for (const l of o["lessons"] as unknown[]) {
			const x = l as { type?: unknown; text?: unknown } | null;
			if (typeof x?.type !== "string" || !LESSON_TYPES.includes(x.type)) return fail("each lesson needs a type of gotcha, pattern or decision");
			if (typeof x.text !== "string" || x.text.length > MAX_TEXT) return fail("each lesson needs text");
			lessons.push({ type: x.type as LessonType, text: x.text.trim() });
		}
	}

	const summary: SaveSummary = { project: o["project"], kind: o["kind"], ...lists, decisions, lessons };
	if (o["clientNote"] !== undefined) {
		if (typeof o["clientNote"] !== "string" || o["clientNote"].length > MAX_TEXT) return fail("clientNote must be a string");
		if (o["clientNote"].trim() !== "") summary.clientNote = o["clientNote"].trim();
	}
	if (o["kind"] === "item") {
		if (typeof o["itemText"] !== "string" || o["itemText"].trim() === "") return fail('an item summary needs itemText');
		if (o["itemText"].length > MAX_TEXT * 2) return fail("itemText is too long");
		summary.itemText = o["itemText"].trim();
	}
	return { ok: true, summary };
}

/** The vault-relative paths a save for `project` may write. */
export function allowedTargets(vaultRoot: string, project: string, now: Date = new Date()): string[] {
	const dir = `work/active/${project}`;
	const day = now.toISOString().slice(0, 10);
	const targets = [
		`${dir}/next.md`,
		`${dir}/tasks.md`,
		`${dir}/decisions.md`,
		`${dir}/sessions/${day}.md`,
		"work/Index.md",
		"brain/Gotchas.md",
		"brain/Patterns.md",
		"brain/Key Decisions.md",
	];
	const client = clientForProject(vaultRoot, project);
	if (client !== null && isSafeFileStem(client)) targets.push(`clients/${client}.md`);
	return targets;
}
