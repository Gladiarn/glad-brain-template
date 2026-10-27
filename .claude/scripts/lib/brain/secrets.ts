/**
 * The secret guard's scanner. It finds the shapes of API keys and tokens in
 * text or in a staged diff and reports only the rule and the place, never
 * the value, so its own output can not leak what it found.
 */

export type SecretHit = { rule: string; line: number };
export type DiffHit = { file: string; line: number; rule: string };

const RULES: readonly { rule: string; re: RegExp }[] = [
	{ rule: "gemini-key", re: /(?<![A-Za-z0-9])AIza[0-9A-Za-z_-]{35}/ },
	{ rule: "openai-key", re: /(?<![A-Za-z0-9])sk-[A-Za-z0-9]{20,}/ },
	{ rule: "github-token", re: /(?<![A-Za-z0-9])gh[pousr]_[A-Za-z0-9]{36}/ },
	{ rule: "private-key", re: /-----BEGIN [A-Z ]*PRIVATE KEY-----/ },
	{ rule: "slack-token", re: /(?<![A-Za-z0-9])xox[baprs]-/ },
];

function rulesIn(line: string): string[] {
	return RULES.filter((r) => r.re.test(line)).map((r) => r.rule);
}

export function scanForSecrets(text: string): SecretHit[] {
	const hits: SecretHit[] = [];
	text.split(/\r?\n/).forEach((line, i) => {
		for (const rule of rulesIn(line)) hits.push({ rule, line: i + 1 });
	});
	return hits;
}

/** Scan the added lines of a unified diff, reporting the file and the new line number. */
export function scanDiff(diff: string): DiffHit[] {
	const hits: DiffHit[] = [];
	let file: string | null = null;
	let oldLeft = 0;
	let newLeft = 0;
	let newLine = 0;
	for (const raw of diff.split("\n")) {
		const line = raw.endsWith("\r") ? raw.slice(0, -1) : raw;
		if (oldLeft > 0 || newLeft > 0) {
			const tag = line[0];
			if (tag === "+") {
				for (const rule of rulesIn(line.slice(1))) if (file !== null) hits.push({ file, line: newLine, rule });
				newLine++;
				newLeft--;
			} else if (tag === "-") {
				oldLeft--;
			} else if (tag === "\\") {
				/* "no newline at end of file" */
			} else {
				newLine++;
				newLeft--;
				oldLeft--;
			}
			continue;
		}
		if (line.startsWith("+++ ")) {
			const p = line.slice(4);
			file = p === "/dev/null" ? null : p.replace(/^b\//, "");
			continue;
		}
		const m = /^@@ -\d+(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/.exec(line);
		if (m) {
			oldLeft = m[1] === undefined ? 1 : Number(m[1]);
			newLeft = m[3] === undefined ? 1 : Number(m[3]);
			newLine = Number(m[2]);
		}
	}
	return hits;
}
