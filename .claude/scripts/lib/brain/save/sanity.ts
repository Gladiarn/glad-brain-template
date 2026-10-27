/**
 * The plain-script check that runs on whatever Gemini proposes, before
 * anything is written. It does not trust the model's own self-check: it
 * looks for the shapes of a destructive write that a script can see.
 */

export type Proposed = { path: string; old: string | null; next: string };

const FRONTMATTER = /^---\r?\n[\s\S]*?\r?\n---(?:\r?\n|$)/;

/** Headings with at least one non-blank line of content under them, lowercased. */
function filledHeadings(text: string): Set<string> {
	const out = new Set<string>();
	const lines = text.replace(FRONTMATTER, "").split(/\r?\n/);
	let current: string | null = null;
	let filled = false;
	const close = () => {
		if (current !== null && filled) out.add(current);
	};
	for (const line of lines) {
		const m = /^#{1,6}\s+(.+?)\s*#*\s*$/.exec(line);
		if (m) {
			close();
			current = m[1]!.toLowerCase();
			filled = false;
		} else if (current !== null && line.trim() !== "" && !/^-\s*$/.test(line.trim())) {
			filled = true;
		}
	}
	close();
	return out;
}

function allHeadings(text: string): Set<string> {
	const out = new Set<string>();
	for (const line of text.replace(FRONTMATTER, "").split(/\r?\n/)) {
		const m = /^#{1,6}\s+(.+?)\s*#*\s*$/.exec(line);
		if (m) out.add(m[1]!.toLowerCase());
	}
	return out;
}

const isPlan = (path: string) => path.endsWith("/next.md");

/** A reason to refuse the proposal, or null when it passes. */
export function checkProposed(files: readonly Proposed[], shrinkLimit: number): string | null {
	for (const f of files) {
		if (f.next.trim() === "") return `${f.path} would be empty`;
		if (f.old === null || f.old.trim() === "") continue;
		if (FRONTMATTER.test(f.old) && !FRONTMATTER.test(f.next)) return `${f.path} would lose its frontmatter`;
		// The plan is rewritten in place on purpose, so it may get shorter; every
		// other file only ever grows or is merged, so a big shrink is a lost note.
		if (!isPlan(f.path)) {
			const before = Buffer.byteLength(f.old, "utf8");
			const after = Buffer.byteLength(f.next, "utf8");
			if (after < before * (1 - shrinkLimit)) {
				return `${f.path} would shrink from ${before} to ${after} bytes (limit ${Math.round(shrinkLimit * 100)}%)`;
			}
		}
		const after = allHeadings(f.next);
		for (const h of filledHeadings(f.old)) {
			if (!after.has(h)) return `${f.path} would drop the heading "${h}" that has content`;
		}
	}
	return null;
}
