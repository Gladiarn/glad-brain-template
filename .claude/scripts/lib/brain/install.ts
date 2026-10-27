/**
 * The pure merges behind setup.sh. Each takes the current text or object and
 * returns the new one, so running setup twice, or after the vault moved,
 * leaves the same single brain entry behind and never touches anything that
 * is the user's.
 */

export const BRAIN_HOOK_EVENTS: readonly { event: string; script: string; timeout: number }[] = [
	// A session start may pull from git, which has its own 15 s limits.
	{ event: "SessionStart", script: "session-start.ts", timeout: 60 },
	{ event: "UserPromptSubmit", script: "classify-message.ts", timeout: 10 },
	{ event: "PostToolUse", script: "validate-write.ts", timeout: 10 },
	{ event: "PreCompact", script: "pre-compact.ts", timeout: 10 },
	{ event: "Stop", script: "stop-checklist.ts", timeout: 10 },
];

type HookCommand = { type?: unknown; command?: unknown };
type HookEntry = { hooks?: unknown };

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

const shellQuote = (s: string) => (/^[A-Za-z0-9_./:@%+=,-]+$/.test(s) ? s : `'${s.replace(/'/g, `'\\''`)}'`);

/** An entry is the brain's when one of its commands runs `bin/brain-hook`. */
function isBrainEntry(entry: unknown): boolean {
	if (!isObject(entry) || !Array.isArray((entry as HookEntry).hooks)) return false;
	return ((entry as HookEntry).hooks as HookCommand[]).some(
		(h) => isObject(h) && typeof h.command === "string" && h.command.includes("bin/brain-hook"),
	);
}

export function mergeHooks(settings: unknown, vaultRoot: string): { settings: unknown; changed: boolean } {
	if (!isObject(settings)) throw new Error("settings.json is not a JSON object");
	const out: Record<string, unknown> = structuredClone(settings);
	if (out["hooks"] !== undefined && !isObject(out["hooks"])) throw new Error('"hooks" in settings.json is not an object');
	const hooks = (out["hooks"] ?? {}) as Record<string, unknown>;
	for (const { event, script, timeout } of BRAIN_HOOK_EVENTS) {
		const current = hooks[event];
		if (current !== undefined && !Array.isArray(current)) throw new Error(`hooks.${event} in settings.json is not a list`);
		const others = (current ?? []).filter((e: unknown) => !isBrainEntry(e));
		const ours = {
			hooks: [{ type: "command", command: `${shellQuote(`${vaultRoot}/bin/brain-hook`)} ${script}`, timeout }],
		};
		const existing = (current ?? []).filter((e: unknown) => isBrainEntry(e));
		// Already exactly right and last: leave the file as it is.
		const unchanged =
			existing.length === 1 &&
			JSON.stringify(existing[0]) === JSON.stringify(ours) &&
			(current ?? []).at(-1) === existing[0];
		hooks[event] = unchanged ? current : [...others, ours];
	}
	out["hooks"] = hooks;
	return { settings: out, changed: JSON.stringify(out) !== JSON.stringify(settings) };
}

export const CLAUDE_MD_OPEN = "<!-- second-brain -->";
export const CLAUDE_MD_CLOSE = "<!-- /second-brain -->";

function claudeMdSection(vaultRoot: string): string {
	return [
		CLAUDE_MD_OPEN,
		"## Second brain",
		"",
		`My notes live in a vault at \`${vaultRoot}\`, an Obsidian vault kept in sync between my PCs with git.`,
		"",
		"- A session in a repo I linked with `brain link` starts with that project's plan for today in its context. Answer \"what's the plan for today?\" from it before searching anywhere.",
		"- When I say `save`, record this session's progress for the current project. When I say `save: <text>`, record that one item. Follow the instruction the hook gives you; do not improvise a save.",
		"- For past decisions, client preferences, gotchas and patterns, ask the vault before guessing: use the `om` MCP tools (`search`, `recall`, `expand`) first.",
		`- For how projects, clients and lessons connect, query the graph: \`graphify query "<question>" --graph ${vaultRoot}/graphify-out/graph.json\`.`,
		"- Never write a secret into the vault, and never commit the vault from a session in a code repo.",
		CLAUDE_MD_CLOSE,
	].join("\n");
}

export function mergeClaudeMd(text: string, vaultRoot: string): { text: string; changed: boolean } {
	const section = claudeMdSection(vaultRoot);
	const open = text.indexOf(CLAUDE_MD_OPEN);
	let next: string;
	if (open === -1) {
		next = text === "" ? `${section}\n` : `${text.replace(/\n*$/, "\n")}\n${section}\n`;
	} else {
		const close = text.indexOf(CLAUDE_MD_CLOSE, open);
		if (close === -1) throw new Error("CLAUDE.md has an opening second-brain marker with no closing one; fix it by hand");
		next = text.slice(0, open) + section + text.slice(close + CLAUDE_MD_CLOSE.length);
	}
	return { text: next, changed: next !== text };
}

export function setQmdEnabled(configText: string, enabled: boolean): string {
	let config: Record<string, unknown> = {};
	if (configText.trim() !== "") {
		let parsed: unknown;
		try {
			parsed = JSON.parse(configText);
		} catch {
			throw new Error("brain.config.json is not valid JSON; fix it by hand");
		}
		if (!isObject(parsed)) throw new Error("brain.config.json is not a JSON object");
		config = parsed;
	}
	config["qmdEnabled"] = enabled;
	return `${JSON.stringify(config, null, "\t")}\n`;
}
