/**
 * Tests for setup.sh, run with HOME pointing at a temp dir, the key on
 * stdin, and fake graphify, claude, uv and npm on PATH. The real settings,
 * shell files and config folder of the machine are never touched.
 */

import { test, describe, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { chmodSync, existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, readlinkSync, statSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { rmTemp } from "./_helpers.ts";
import { CLAUDE_MD_CLOSE, CLAUDE_MD_OPEN } from "../lib/brain/install.ts";
import { REPO_ROOT } from "./_brain-helpers.ts";
import { FAKE_KEY, makeFakeTools, makeTemplateClone, readLog, runSetup, script, tempDir } from "./_brain-setup-helpers.ts";

describe("setup.sh", () => {
	let root: string;
	let home: string;
	let tools: string;
	let clone: string;
	const setup = (o: { args?: string[]; input?: string; env?: Record<string, string>; procVersion?: string } = {}) =>
		runSetup({ clone, home, tools, ...o });
	const readHome = (rel: string) => readFileSync(join(home, rel), "utf8");
	const count = (text: string, needle: string) => text.split(needle).length - 1;

	beforeEach(() => {
		root = tempDir("brain-setup-");
		home = join(root, "home");
		mkdirSync(home);
		tools = join(root, "tools");
		makeFakeTools(tools);
		clone = makeTemplateClone(root);
	});
	afterEach(() => rmTemp(root));

	describe("after two runs", () => {
		let first: ReturnType<typeof setup>;
		let second: ReturnType<typeof setup>;
		const original = {
			model: "opus",
			hooks: {
				SessionStart: [{ hooks: [{ type: "command", command: "echo my own hook" }] }],
				Stop: [{ hooks: [{ type: "command", command: "notify-send done" }] }],
			},
		};

		beforeEach(() => {
			mkdirSync(join(home, ".claude"), { recursive: true });
			writeFileSync(join(home, ".claude", "settings.json"), JSON.stringify(original, null, 2));
			writeFileSync(join(home, ".claude", "CLAUDE.md"), "# My global rules\n\n- be brief\n");
			writeFileSync(join(home, ".zshrc"), "export FOO=1\n");
			first = setup();
			second = setup();
		});

		test("both runs succeed", () => {
			assert.equal(first.code, 0, first.stdout + first.stderr);
			assert.equal(second.code, 0, second.stdout + second.stderr);
		});

		test("settings.json keeps the user's hooks and holds exactly one brain entry per event", () => {
			const s = JSON.parse(readHome(".claude/settings.json")) as { model: string; hooks: Record<string, { hooks: { command: string }[] }[]> };
			assert.equal(s.model, "opus");
			for (const event of ["SessionStart", "UserPromptSubmit", "PostToolUse", "PreCompact", "Stop"]) {
				const mine = (s.hooks[event] ?? []).filter((e) => e.hooks.some((h) => h.command.includes("bin/brain-hook")));
				assert.equal(mine.length, 1, event);
				assert.ok(mine[0]!.hooks[0]!.command.includes(clone), event);
			}
			assert.ok(s.hooks["SessionStart"]!.some((e) => e.hooks[0]!.command === "echo my own hook"));
			assert.ok(s.hooks["Stop"]!.some((e) => e.hooks[0]!.command === "notify-send done"));
		});

		test("the settings were backed up before the first change", () => {
			const backups = readdirSync(join(home, ".claude")).filter((f) => f.startsWith("settings.json.bak-"));
			assert.ok(backups.length >= 1);
			assert.deepEqual(JSON.parse(readHome(`.claude/${backups[0]}`)), original);
		});

		test("the second run leaves settings.json byte for byte as the first left it, with no new backup", () => {
			const before = readHome(".claude/settings.json");
			const backups = readdirSync(join(home, ".claude")).filter((f) => f.includes(".bak-")).length;
			setup();
			assert.equal(readHome(".claude/settings.json"), before);
			assert.equal(readdirSync(join(home, ".claude")).filter((f) => f.includes(".bak-")).length, backups);
		});

		test(".env is mode 600, in a private folder, holds the vault and the key, and puts bin on PATH", () => {
			const env = join(home, ".config", "second-brain", ".env");
			assert.equal(statSync(env).mode & 0o777, 0o600);
			assert.equal(statSync(join(home, ".config", "second-brain")).mode & 0o777, 0o700);
			const text = readFileSync(env, "utf8");
			assert.ok(text.includes(`BRAIN_VAULT='${clone}'`));
			assert.ok(text.includes(`GEMINI_API_KEY='${FAKE_KEY}'`));
			const sourced = spawnSync("bash", ["-c", `set -a; . "${env}"; set +a; echo "$BRAIN_VAULT"; echo "$GEMINI_API_KEY"; echo "$PATH"`], {
				encoding: "utf8",
				env: { PATH: "/usr/bin:/bin" },
			});
			const [vault, key, path] = sourced.stdout.trim().split("\n");
			assert.equal(vault, clone);
			assert.equal(key, FAKE_KEY);
			assert.ok(path!.split(":").includes(`${clone}/bin`));
		});

		test("the second run, given no key, keeps the one already stored", () => {
			setup({ input: "\n" });
			assert.ok(readHome(".config/second-brain/.env").includes(FAKE_KEY));
		});

		test("the key is only ever in .env", () => {
			for (const out of [first, second]) {
				assert.ok(!out.stdout.includes(FAKE_KEY), "key on stdout");
				assert.ok(!out.stderr.includes(FAKE_KEY), "key on stderr");
			}
			for (const f of [".claude/settings.json", ".claude/CLAUDE.md", ".zshrc", ".bashrc"]) {
				assert.ok(!readHome(f).includes(FAKE_KEY), f);
			}
			assert.ok(!readFileSync(join(clone, "brain.config.json"), "utf8").includes(FAKE_KEY));
		});

		test("each shell rc file has exactly one marked source line", () => {
			for (const rc of [".zshrc", ".bashrc"]) {
				const text = readHome(rc);
				assert.equal(count(text, "# second-brain"), 1, rc);
				assert.ok(text.includes(".config/second-brain/.env"), rc);
			}
			assert.ok(readHome(".zshrc").startsWith("export FOO=1\n"), "existing rc content was disturbed");
		});

		test("CLAUDE.md has one marked section and keeps the user's text", () => {
			const text = readHome(".claude/CLAUDE.md");
			assert.equal(count(text, CLAUDE_MD_OPEN), 1);
			assert.equal(count(text, CLAUDE_MD_CLOSE), 1);
			assert.ok(text.startsWith("# My global rules\n\n- be brief\n"));
			assert.ok(text.includes(clone));
		});

		test("claude mcp add ran once per run, at user scope", () => {
			const adds = readLog(tools, "claude").filter((l) => l.startsWith("mcp add"));
			assert.equal(adds.length, 2);
			for (const a of adds) {
				assert.equal(a, `mcp add --scope user om -- node ${clone}/.claude/scripts/om-mcp.mjs`);
			}
		});

		test("the secret guard is installed as the vault's pre-commit hook", () => {
			const hook = join(clone, ".git", "hooks", "pre-commit");
			assert.ok(lstatSync(hook).isSymbolicLink());
			assert.equal(readlinkSync(hook), join(clone, "bin", "brain-precommit"));
		});

		test("it points at the vault from Windows, and mentions the .wslconfig memory setting", () => {
			assert.ok(first.stdout.includes(`\\\\wsl.localhost\\Ubuntu-Test${clone.split("/").join("\\")}`), first.stdout);
			assert.match(first.stdout, /\.wslconfig/);
			assert.match(first.stdout, /Obsidian/);
		});
	});

	test("--no-install skips uv, graphify install and the qmd install; a full run does them", () => {
		assert.equal(setup().code, 0);
		assert.deepEqual(readLog(tools, "uv"), []);
		assert.deepEqual(readLog(tools, "graphify"), []);
		assert.deepEqual(readLog(tools, "npm"), []);

		const full = setup({ args: ["--non-interactive", "--no-qmd"] });
		assert.equal(full.code, 0, full.stdout + full.stderr);
		assert.deepEqual(readLog(tools, "uv"), ["tool install graphifyy[gemini]"]);
		assert.deepEqual(readLog(tools, "graphify"), ["install"]);
		assert.deepEqual(readLog(tools, "npm"), [], "--no-qmd must not install qmd");

		const withQmd = setup({ args: ["--non-interactive"] });
		assert.equal(withQmd.code, 0, withQmd.stdout + withQmd.stderr);
		assert.deepEqual(readLog(tools, "npm"), ["install -g @tobilu/qmd"]);
	});

	test("--no-qmd sets qmdEnabled false and never runs the bootstrap", () => {
		assert.equal(setup().code, 0);
		assert.equal(JSON.parse(readFileSync(join(clone, "brain.config.json"), "utf8")).qmdEnabled, false);
		assert.deepEqual(readLog(root, "qmd-bootstrap"), []);
	});

	test("without --no-qmd the bootstrap runs and qmdEnabled stays true", () => {
		const r = setup({ args: ["--non-interactive", "--no-install"] });
		assert.equal(r.code, 0, r.stdout + r.stderr);
		assert.equal(JSON.parse(readFileSync(join(clone, "brain.config.json"), "utf8")).qmdEnabled, true);
		assert.deepEqual(readLog(root, "qmd-bootstrap"), ["ran"]);
	});

	test("a qmd bootstrap that fails turns qmdEnabled off, warns, and does not stop the setup", () => {
		rmTemp(clone);
		clone = makeTemplateClone(root, { bootstrapExit: 1 });
		const r = setup({ args: ["--non-interactive", "--no-install"] });
		assert.equal(r.code, 0, r.stdout + r.stderr);
		assert.equal(JSON.parse(readFileSync(join(clone, "brain.config.json"), "utf8")).qmdEnabled, false);
		assert.match(r.stderr, /qmd/i);
	});

	test("other keys in brain.config.json survive the qmd switch", () => {
		writeFileSync(join(clone, "brain.config.json"), JSON.stringify({ geminiModel: "gemini-x", qmdEnabled: true }));
		setup();
		const c = JSON.parse(readFileSync(join(clone, "brain.config.json"), "utf8"));
		assert.deepEqual(c, { geminiModel: "gemini-x", qmdEnabled: false });
	});

	test("no key on stdin and none stored: it finishes and says the save will fall back to Claude", () => {
		const r = setup({ input: "" });
		assert.equal(r.code, 0, r.stdout + r.stderr);
		assert.ok(!readFileSync(join(home, ".config", "second-brain", ".env"), "utf8").includes("GEMINI_API_KEY"));
		assert.match(r.stdout + r.stderr, /no Gemini key/i);
	});

	test("a key that does not look like a key is refused without being echoed", () => {
		const bad = "abc def'; rm -rf ~";
		const r = setup({ input: `${bad}\n` });
		assert.notEqual(r.code, 0);
		assert.ok(!(r.stdout + r.stderr).includes(bad));
		assert.ok(!existsSync(join(home, ".config", "second-brain", ".env")));
	});

	test("an old Node stops it with a message", () => {
		const old = join(root, "old-node");
		mkdirSync(old);
		script(join(old, "node"), 'echo 20');
		const r = runSetup({ clone, home, tools: `${old}:${tools}` });
		assert.notEqual(r.code, 0);
		assert.match(r.stdout + r.stderr, /Node 22/);
		assert.ok(!existsSync(join(home, ".config")));
	});

	test("a machine that is not WSL stops it with a message, and nothing is written", () => {
		const r = setup({ procVersion: "Linux version 6.1.0-generic (buildd@ubuntu)\n" });
		assert.notEqual(r.code, 0);
		assert.match(r.stdout + r.stderr, /WSL/);
		assert.ok(!existsSync(join(home, ".config")));
		assert.ok(!existsSync(join(home, ".claude")));
	});

	test("a settings.json that is not valid JSON is left alone, and the setup says so", () => {
		mkdirSync(join(home, ".claude"), { recursive: true });
		writeFileSync(join(home, ".claude", "settings.json"), "{ not json");
		const r = setup();
		assert.notEqual(r.code, 0);
		assert.match(r.stdout + r.stderr, /settings\.json/);
		assert.equal(readHome(".claude/settings.json"), "{ not json");
	});

	test("an existing pre-commit hook that is not ours is kept, with a warning", () => {
		const hook = join(clone, ".git", "hooks", "pre-commit");
		mkdirSync(join(clone, ".git", "hooks"), { recursive: true });
		writeFileSync(hook, "#!/bin/sh\necho mine\n");
		chmodSync(hook, 0o755);
		const r = setup();
		assert.equal(r.code, 0, r.stdout + r.stderr);
		assert.ok(!lstatSync(hook).isSymbolicLink());
		assert.match(r.stdout + r.stderr, /pre-commit/);
	});

	test("without the claude CLI it still finishes and tells you how to register the MCP server", () => {
		const noClaude = join(root, "tools-no-claude");
		makeFakeTools(noClaude, { claude: false });
		const r = runSetup({ clone, home, tools: noClaude });
		assert.equal(r.code, 0, r.stdout + r.stderr);
		assert.match(r.stdout + r.stderr, /claude mcp add/);
	});

	test("a claude mcp add that fails because the server exists is re-registered, not an error", () => {
		const log = join(tools, "claude.log");
		script(join(tools, "claude"), `printf '%s\\n' "$*" >> "${log}"\ncase "$1 $2" in "mcp add") [ -f "${join(root, "added")}" ] && exit 1; touch "${join(root, "added")}"; exit 0;; esac\nexit 0`);
		assert.equal(setup().code, 0);
		const second = setup();
		assert.equal(second.code, 0, second.stdout + second.stderr);
		assert.ok(readLog(tools, "claude").some((l) => l.startsWith("mcp remove")));
	});

	test("an unknown option prints usage and exits 2", () => {
		const r = setup({ args: ["--frobnicate"] });
		assert.equal(r.code, 2);
		assert.match(r.stderr, /usage/i);
	});

	test("the repo's own brain.config.json is never touched, only the clone's", () => {
		const repoConfig = join(REPO_ROOT, "brain.config.json");
		const before = readFileSync(repoConfig, "utf8");
		setup();
		assert.equal(readFileSync(repoConfig, "utf8"), before);
		assert.equal(JSON.parse(readFileSync(join(clone, "brain.config.json"), "utf8")).qmdEnabled, false);
	});

	test("the real settings and shell files are never touched", () => {
		const real = process.env["HOME"] ?? "";
		const before = ["/.claude/settings.json", "/.zshrc", "/.bashrc", "/.claude/CLAUDE.md"].map((f) => {
			try {
				return statSync(real + f).mtimeMs;
			} catch {
				return null;
			}
		});
		setup();
		const after = ["/.claude/settings.json", "/.zshrc", "/.bashrc", "/.claude/CLAUDE.md"].map((f) => {
			try {
				return statSync(real + f).mtimeMs;
			} catch {
				return null;
			}
		});
		assert.deepEqual(after, before);
		assert.notEqual(real, home);
	});
});
