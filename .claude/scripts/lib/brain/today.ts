/**
 * The plan for today: a project's `next.md` and its open tasks, shaped to be
 * injected at session start. Only the resolved project's files are read, so
 * the context stays the same size however many projects the vault holds.
 */

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { cutLine, type OutputLimit } from "../hook-io.ts";
import { stripFrontmatter } from "../session-start.ts";
import type { ResolvedProject } from "./project.ts";

export const TODAY_LIMIT: OutputLimit = { max: 3500, unit: "bytes", name: "the plan-for-today budget" };
const TASK_CAP = 20;

const bytes = (s: string) => Buffer.byteLength(s, "utf8");

function readOrNull(path: string): string | null {
	try {
		return existsSync(path) ? readFileSync(path, "utf8") : null;
	} catch {
		return null;
	}
}

/** Keep whole lines from the top until the next one would pass the limit, then say so. */
function cutToLimit(text: string, limit: OutputLimit): string {
	if (bytes(text) <= limit.max) return text;
	const marker = cutLine(limit);
	const lines = text.split("\n");
	const kept: string[] = [];
	let size = bytes(`\n${marker}`);
	for (const line of lines) {
		const next = bytes(line) + 1;
		if (size + next > limit.max) break;
		kept.push(line);
		size += next;
	}
	return `${kept.join("\n")}\n${marker}`;
}

function openTasks(tasksText: string): string | null {
	const open = stripFrontmatter(tasksText)
		.split(/\r?\n/)
		.filter((l) => /^\s*- \[ \]\s*\S/.test(l));
	if (open.length === 0) return null;
	const shown = open.slice(0, TASK_CAP);
	const rest = open.length - shown.length;
	return ["#### Open tasks", ...shown, ...(rest > 0 ? [`(${rest} more open tasks in tasks.md)`] : [])].join("\n");
}

/** True when `next.md` still reads as the fresh template: no line has content outside Related. */
export function planIsEmpty(nextText: string): boolean {
	let inRelated = false;
	for (const line of stripFrontmatter(nextText).replace(/%%[\s\S]*?%%/g, "").split(/\r?\n/)) {
		if (/^#{1,6} /.test(line)) {
			inRelated = /^## Related\b/.test(line);
			continue;
		}
		if (inRelated) continue;
		if (line.replace(/^\s*(?:[-*]|\d+\.)?\s*/, "") !== "") return false;
	}
	return true;
}

export function todayContext(vaultRoot: string, project: ResolvedProject): string {
	const title = `### Plan for today: ${project.name}${project.client === null ? "" : ` (client: ${project.client})`}`;
	const rel = `work/active/${project.name}`;
	const nextText = readOrNull(join(project.dir, "next.md"));
	if (nextText === null) {
		return `${title}\n(no plan yet: ${rel}/next.md does not exist in ${vaultRoot}; create it or run \`brain link\`)`;
	}
	const body = stripFrontmatter(nextText)
		.replace(/%%[\s\S]*?%%\n*/g, "")
		.trim();
	const parts = [title, body];
	const tasksText = readOrNull(join(project.dir, "tasks.md"));
	const tasks = tasksText === null ? null : openTasks(tasksText);
	if (tasks !== null) parts.push(tasks);
	return cutToLimit(parts.join("\n\n"), TODAY_LIMIT);
}
