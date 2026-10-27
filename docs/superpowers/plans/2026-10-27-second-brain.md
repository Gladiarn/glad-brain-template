# Second Brain Template Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn obsidian-mind v10 into a reusable second-brain template for a web dev and designer. It adds per-project plans, a `save` trigger with Gemini filing (Claude fallback), two-PC git sync, global hooks, `brain link`, graphify, a secret guard and `setup.sh`.

**Architecture:** The template repo is obsidian-mind with its git history and `upstream` as a remote. New logic lives as zero-dependency TypeScript modules under `.claude/scripts/lib/brain/`, plus one CLI entry, `.claude/scripts/brain.ts`, wrapped by `bin/brain`. The existing hooks (`session-start.ts`, `classify-message.ts`) gain small calls into those modules. A global launcher, `bin/brain-hook`, makes the hooks fire in linked code repos.

**Tech Stack:** Node 22+ with `--experimental-strip-types` (as obsidian-mind), `node:test`, bash for `setup.sh`/`bin/*`, the Gemini REST API via `fetch`, graphify CLI 0.9.96, QMD, and git.

**Spec:** `docs/superpowers/specs/2026-10-27-second-brain-design.md` (read it first; this plan argues from it).

## Global Constraints

- **Runtime:** zero dependencies, following obsidian-mind's rule in `.claude/scripts/package.json`. Run with `node --experimental-strip-types`, Node ≥ 22. Use only `fetch` and `node:*` modules.
- **Tests:** `cd .claude/scripts && npm test` (node:test via `tests/_run-tests.ts`). New tests go in `.claude/scripts/tests/brain-*.test.ts`. Match the style of `tests/classify-message.test.ts` and the helpers in `tests/_helpers.ts`.
- **Platform:** WSL/Linux only, and native Windows is out of scope. The vault is on the WSL filesystem.
- **Hooks never block a session:** every hook path exits 0. Every network or git call has a timeout, and on failure prints one warning line.
- **Gemini:**
  - The model comes from config, default `gemini-3.8-flash`. The key comes from env `GEMINI_API_KEY` and is sent in the `x-goog-api-key` header, never in a URL, a log or an error message.
  - At most 2 check/fix rounds.
  - The fallback uses a Claude **Sonnet** subagent.
- **The key is never written inside the repo.** It lives only in `~/.config/second-brain/.env` with mode 600.
- **Repurpose, don't delete:** follow the spec's "Repurpose, don't delete" table exactly. Remove only the items it lists as removed.
- **Licences:** keep obsidian-mind's `LICENSE`. Add `NOTICE.md` crediting obsidian-mind (MIT), BrineWR71/obsidian-project-vault-template (MIT), graphify (Apache-2.0) and lucasrosati/claude-code-memory-setup (MIT, idea only).
- **Git:** do not commit. The orchestrating session commits with conventional messages and no AI attribution.

## Review Focus

1. **Hooks firing twice inside the vault.** The vault's own `.claude/settings.json` and the global launcher both fire there, and the global launcher must stay silent in the vault. The test for this lives in Task 5.
2. **`save` look-alikes.** `"save."`, `"Save"`, `"  save\n"` and `"save:"` with multiline text must trigger. `"save it"`, `"add a save button"` and `"save the form data"` must not. Tested in Task 6.
3. **Gemini output that writes outside the allowed files.** This covers `../` traversal, another project's folder and absolute paths. The whole save must be rejected with nothing written. Tested in Task 7.
4. **Two PCs editing the same note.** A pull conflict must leave the working tree as it was before the pull, list the conflicted files and never overwrite. Tested in Task 8.
5. **Two sessions on one PC saving at once.** The second waits on a lock, at most 30 s, then reports "save busy" instead of racing git. Tested in Task 8.

---

### Task 1: Import obsidian-mind and measure the baseline

**Files:**
- Modify: repo root (merge upstream history)
- Create: `NOTICE.md`, `docs/startup-measure.md`

**Interfaces:**
- Produces: the obsidian-mind tree at the repo root with the `upstream` remote, and a passing baseline test run.

- [ ] **Step 1:** Add the remote and merge, keeping `docs/` from this repo:
  - `git remote add upstream https://github.com/breferrari/obsidian-mind.git`
  - `git fetch upstream`
  - `git merge upstream/main --allow-unrelated-histories --no-commit`

  Resolve so that both `docs/superpowers/` and every upstream file are present.
- [ ] **Step 2:** `cd .claude/scripts && npm test`. Expected: all upstream tests pass. Record the pass count in `docs/startup-measure.md` as the baseline.
- [ ] **Step 3:** Measure the startup instruction bytes: `AGENTS.md` plus `.claude/rules/*.md`, and the SessionStart hook output size from `node --experimental-strip-types .claude/scripts/session-start.ts </dev/null | wc -c`, run in the vault. Write both to `docs/startup-measure.md` under "Before".
- [ ] **Step 4:** Write `NOTICE.md` with the four credits from Global Constraints.

**Acceptance:** upstream tests pass unchanged; the baseline numbers are recorded.

### Task 2: Repurpose for a web dev and designer

**Files:**
- Rename: `org/` to `clients/`, `perf/` to `portfolio/`
- Delete: the commands, agents and matching `.gemini/commands/*.toml` files for `om-review-brief`, `om-review-peer`, `om-self-review`, `review-prep`, `review-fact-checker`, `om-slack-scan`, `om-peer-scan`, `slack-archaeologist`. The 1:1 flow (`work/1-1/`, `om-capture-1on1`, `om-prep-1on1`) folds into client meetings: merge any useful prompt text into `om-meeting`, then delete those three.
- Modify:
  - `AGENTS.md`, `.claude/rules/*.md` and `Home.md`
  - `brain/North Star.md`: prompts rewritten for client work, design and dev goals
  - `vault-manifest.json`: drop `work/1-1` from `open_loop_dirs`, rewrite `qmd_context`, rename the paths in `infrastructure`
  - `people-profiler`, renamed to `client-profiler`, which works from vault notes plus what the owner says instead of Slack
  - `brag-spotter`, renamed to `portfolio-spotter`
  - `om-incident-capture`: wording changed to production bugs and outages
  - any test that pins removed names, such as `agent-docs-sync`, `manifest-check` and `shard-contract`
- Test: the existing suite

- [ ] **Step 1:** Make the renames and deletions. Then `grep -rnE "org/|perf/|1-1|slack|brag|self-review|peer" --exclude-dir=.git --exclude=CHANGELOG.md .`. Expected: only intentional hits, with each one listed in the report.
- [ ] **Step 2:** Path-scope the rules that apply only to certain folders, using Claude Code's `paths:` frontmatter. Candidates are `obsidian-cli.md`, `vault-from-another-repo.md` and `hooks-and-mod.md`. Keep always-loaded anything a normal session in a project needs. Do not drop content to save bytes.
- [ ] **Step 2b:** Every kept command that calls `obsidian …` (for example `om-standup`'s `obsidian daily:read` and `obsidian tasks daily todo`) gets a filesystem fallback written into the command text, used when the CLI is missing or Obsidian is closed. The spec says the Obsidian CLI may not be reachable from WSL.
- [ ] **Step 3:** `npm test` passes. Fix the tests that pin removed names by updating them, not by deleting coverage.
- [ ] **Step 4:** Re-measure and write "After" into `docs/startup-measure.md`, with one line per removed or scoped item.

**Acceptance:** tests green; no dangling references to removed commands; the before and after numbers are recorded.

### Task 3: Config, project resolution and project templates

**Files:**
- Create:
  - `.claude/scripts/lib/brain/config.ts`, `.claude/scripts/lib/brain/project.ts`
  - `brain.config.json`, `projects.map.json` (initially `{"projects":{}}`)
  - `templates/Project Next.md`, `templates/Project Tasks.md`, `templates/Session.md`, `templates/Decision.md` (adapted from BrineWR71's Next Session, Project, Session and Decision templates)
  - `work/active/general/next.md`, `work/active/general/tasks.md`
- Modify: `work/Index.md` (a `general` line)
- Test: `tests/brain-config.test.ts`, `tests/brain-project.test.ts`

**Interfaces:**
- Produces:
  - `loadConfig(vaultRoot: string): BrainConfig`, where `BrainConfig = { geminiModel: string; fallbackModel: "sonnet"; qmdEnabled: boolean; maxFixRounds: number; shrinkLimit: number }`. The defaults are `"gemini-3.8-flash"`, `"sonnet"`, `true`, `2` and `0.4`.
  - `normalizeRemote(url: string): string`
  - `type ResolvedProject = { name: string; dir: string; client: string | null; source: "remote" | "path" | "vault" }`
  - `resolveProject(cwd: string, vaultRoot: string): ResolvedProject | null`

- [ ] **Step 1: Failing tests:**
  - `normalizeRemote("git@github.com:Me/Site.git") === normalizeRemote("https://github.com/me/site")`, giving `"github.com/me/site"`
  - a cwd inside the vault gives `{name:"general", source:"vault"}`
  - a linked repo with a remote resolves by remote, even from a different absolute path (simulating the second PC)
  - a repo with no remote resolves only by its exact path entry
  - an unlinked repo gives `null`
  - a missing or invalid `brain.config.json` gives the defaults
- [ ] **Step 2:** Run `npm test`. Expected: FAIL (module missing).
- [ ] **Step 3:** Implement. Read the remote with `git -C <cwd> remote get-url origin`, with a 2 s timeout. Map entries take the form `{ "<normalized remote or path:/abs>": { "project": "client-site", "client": "acme" | null } }`.
- [ ] **Step 4:** `npm test` passes.

### Task 4: `brain` CLI with `link`

**Files:**
- Create: `.claude/scripts/brain.ts`, `bin/brain` (bash wrapper that resolves the vault from its own location)
- Test: `tests/brain-link.test.ts`

**Interfaces:**
- Consumes: Task 3's `resolveProject`, `normalizeRemote`, `loadConfig`
- Produces: `brain link [--project <name>] [--client <name>] [--repo <path>]` (the repo defaults to cwd) and `brain status`. The subcommands `save`, `graph` and `sync` are added by later tasks to the same dispatcher.

- [ ] **Step 1: Failing tests** (run `brain.ts` as a subprocess against a temp vault and a temp repo):
  - link creates the map entry, creates `work/active/<project>/next.md` and `tasks.md` from the templates, and adds one line to `work/Index.md`
  - running link twice is idempotent: no duplicate Index line, existing `next.md` untouched
  - the project name defaults to the repo folder name, kebab-cased
  - `--project ../x` is rejected
  - link never writes any file inside the code repo (assert the repo's `git status --porcelain` is empty)
  - link runs `graphify update <repo>` (code-only, free) when `graphify` is on PATH and skips with a note when it isn't. Use a fake `graphify` on PATH in the test.
- [ ] **Step 2:** FAIL. **Step 3:** Implement. **Step 4:** PASS.

### Task 5: Global hooks and plan-for-today injection

**Files:**
- Create: `bin/brain-hook` (bash, `brain-hook <script-name>`), `.claude/scripts/lib/brain/today.ts`
- Modify:
  - `.claude/scripts/session-start.ts` (call `todayContext` and add its output as a section within the existing budget)
  - `.claude/commands/om-standup.md`: "plan for today" reads the current project's `next.md` and `tasks.md` from the injection first, and only opens other files when the injection lacks something. Answering "what's the plan for today?" must need no extra searching.
- Test: `tests/brain-hook.test.ts`, `tests/brain-today.test.ts`

**Interfaces:**
- Consumes: `resolveProject`, plus Task 8's `pull` and Task 9's `unsavedReminder`. Stub both until those tasks land; the final wiring is checked in Task 12.
- Produces: `todayContext(vaultRoot: string, project: ResolvedProject): string` (the project's `next.md` plus open tasks, within budget)

- [ ] **Step 1: Failing tests:**
  - `brain-hook session-start.ts` with `CLAUDE_PROJECT_DIR` inside the vault prints nothing and exits 0 (**Review Focus 1**)
  - with an unlinked repo it prints nothing and exits 0
  - with a linked repo the output contains that project's `next.md` "What To Do Next" section and no other project's
  - when `BRAIN_VAULT` is unset or points to a missing folder, it exits 0 with one warning line
  - a `next.md` larger than the budget is cut with obsidian-mind's `cutLine` marker
- [ ] **Step 2:** FAIL. **Step 3:** Implement. `bin/brain-hook` reads `BRAIN_VAULT` from `~/.config/second-brain/.env`, exits early when `CLAUDE_PROJECT_DIR` is inside it, and runs `node … $BRAIN_VAULT/.claude/scripts/<script>` with `CLAUDE_PROJECT_DIR` preserved. For linked repos, `session-start.ts` emits only the brain sections (today, unsaved reminder, sync warning), never the vault-wide file listing. **Step 4:** PASS.

### Task 6: `save` trigger detection

**Files:**
- Create: `.claude/scripts/lib/brain/save-trigger.ts`
- Modify: `.claude/scripts/classify-message.ts` (when the trigger matches, add the save instruction as the first part)
- Test: `tests/brain-save-trigger.test.ts`

**Interfaces:**
- Produces: `parseSave(prompt: string): { kind: "session" } | { kind: "item"; text: string } | null`, and `saveInstruction(kind, project): string`. The instruction tells Claude to write a summary JSON matching Task 7's `SaveSummary` to a temp file, run `brain save --summary <file>`, and follow its exit code.

- [ ] **Step 1: Failing tests (Review Focus 2):**
  - `"save"`, `"Save"`, `"SAVE"`, `"  save \n"`, `"save."` and `"save!"` give `session`
  - `"save: use Stripe Checkout"` gives an `item` with that text
  - `"save:\nline1\nline2"` gives an item with both lines
  - `"save:"` and `"save:   "` give `session`
  - `"save it"`, `"add a save button"`, `"save the form data"`, `"autosave"` and `"please save"` give `null`
  - the classify-message subprocess with prompt `"save"` in a linked repo outputs the instruction, and with `"add a save button"` it does not
- [ ] **Step 2:** FAIL. **Step 3:** Implement. **Step 4:** PASS.

### Task 7: Save pipeline (Gemini, self-check, sanity check, fallback)

**Files:**
- Create: `.claude/scripts/lib/brain/save/schema.ts`, `gemini.ts`, `pipeline.ts`, `sanity.ts`, `log.ts`
- Modify: `brain.ts` (the `save` subcommand)
- Test: `tests/brain-save.test.ts` (inject a fake fetch; no network)

**Interfaces:**
- Consumes: `loadConfig`, `resolveProject`, obsidian-mind's `lib/atomic-write.ts`
- Produces:
  - `SaveSummary = { project: string; kind: "session" | "item"; done: string[]; addedTasks: string[]; decisions: {title: string; why: string}[]; lessons: {type: "gotcha" | "pattern" | "decision"; text: string}[]; next: string[]; blocked: string[]; clientNote?: string; itemText?: string }`
  - `allowedTargets(vaultRoot, project): string[]`: the project folder files, `work/Index.md`, `brain/Gotchas.md`, `brain/Patterns.md`, `brain/Key Decisions.md`, and `clients/<client>.md` when the map has a client
  - `runSave(opts: { vaultRoot: string; summary: SaveSummary; fetchImpl?: typeof fetch; now?: Date }): Promise<{ outcome: "saved" | "fallback"; reason?: string; files: string[] }>`
  - CLI exit codes: `0` means saved by Gemini. `3` means fallback: stdout carries the reason and the exact file list for a Sonnet subagent to update, and nothing was written. `1` means a bad summary.
  - `brain save --commit-only` commits and pushes after a Claude fallback save.
- **Gemini protocol:**
  - POST `https://generativelanguage.googleapis.com/v1beta/models/<model>:generateContent` with `responseMimeType: "application/json"`.
  - The write pass returns `{ files: { path: string; content: string }[] }`.
  - The check pass gets the summary, the old files and the new files, and returns `{ ok: boolean; problems: string[] }`, checking for lost content, invented facts, duplicates and wrong project.
  - A fix pass gets the problems. Then check again, up to `maxFixRounds`.
  - Tokens come from `usageMetadata`.

- [ ] **Step 1: Failing tests:**
  - happy path: the files are written atomically, `next.md` is replaced (not appended), and one JSON line goes to `.brain/save-log.jsonl` with `{ts, project, model, promptTokens, outputTokens, rounds, outcome}`
  - **(Review Focus 3)** a path that is not in `allowedTargets`, contains `../`, or is absolute gives `fallback` with no files touched
  - a check that fails twice gives `fallback` with no files touched
  - HTTP 429, 5xx, a timeout (20 s) or a network error gives `fallback`
  - a missing `GEMINI_API_KEY` gives `fallback` with reason `"no Gemini key"`
  - the sanity check rejects a new file whose content shrinks by more than `shrinkLimit`, or that drops a non-empty heading, giving `fallback`
  - neither the key string nor the header ever appears in the log line, stdout or a thrown error message (assert on a known fake key)
- [ ] **Step 2:** FAIL. **Step 3:** Implement. On a `saved` outcome, the pipeline calls Task 8's `commitPush("brain: save <project>")`, and Task 9's `markSaved(project)`. **Step 4:** PASS.

### Task 8: Git sync and the save lock

**Files:**
- Create: `.claude/scripts/lib/brain/sync.ts`
- Modify: `brain.ts` (the `sync` subcommand)
- Test: `tests/brain-sync.test.ts` (temp bare remote plus two clones simulating the two PCs)

**Interfaces:**
- Produces:
  - `pull(vaultRoot): { ok: true } | { ok: false; warning: string; conflicts?: string[] }`, which runs `git pull --rebase --autostash` with a 15 s timeout
  - `commitPush(vaultRoot, message): { pushed: boolean; warning?: string }`
  - `withSaveLock<T>(vaultRoot, fn: () => Promise<T>): Promise<T | "busy">`, using `.brain/save.lock` with a 30 s wait and stale-lock takeover after 10 min

- [ ] **Step 1: Failing tests:**
  - clone A commits and pushes, then `pull` in clone B brings the change in
  - an unreachable remote gives `ok:false` with a warning and no exception
  - **(Review Focus 4)** with conflicting edits to the same `next.md` in A and B, B's `pull` aborts the rebase, returns `conflicts: ["work/active/x/next.md"]`, and B's file content and HEAD are unchanged
  - a push that fails offline is retried by the next `commitPush`, and the remote then has both commits
  - **(Review Focus 5)** two concurrent `withSaveLock` calls run one after the other, and a third that waits longer than 30 s returns `"busy"`
- [ ] **Step 2:** FAIL. **Step 3:** Implement. **Step 4:** PASS. Wire `pull` into Task 5's session start, replacing the stub, and put its warning text into the injected section.

### Task 9: Unsaved-session reminder

**Files:**
- Create: `.claude/scripts/lib/brain/unsaved.ts`
- Test: `tests/brain-unsaved.test.ts`

**Interfaces:**
- Produces:
  - `markSaved(vaultRoot, project, now?)`, which writes the ISO time to `.brain/last-save/<project>` (machine-local and gitignored)
  - `unsavedReminder(vaultRoot, project, transcriptsDir, currentSessionId): string | null`, where `transcriptsDir` is `~/.claude/projects/<cwd with / replaced by ->`

- [ ] **Step 1: Failing tests:**
  - a transcript newer than the last save, from a different session than the current one, gives a reminder that names the session date. It offers to save and never says it saved anything.
  - only the current session's transcript gives `null`
  - no `last-save` file and an old transcript give a reminder
  - a missing transcripts dir gives `null`
- [ ] **Step 2:** FAIL. **Step 3:** Implement. **Step 4:** PASS. Wire it into session start.

### Task 10: graphify integration

**Files:**
- Create: `.claude/scripts/lib/brain/graph.ts`, `.graphifyignore` (exclude `.obsidian/`, `graphify-out/cache/`, `.brain/`, `bases/`, `templates/`)
- Modify: `brain.ts` (`brain graph [--notes] [--yes]`), `.gitignore` (ignore `graphify-out/cache/` and `.brain/`; keep `graphify-out/graph.json` and `GRAPH_REPORT.md` tracked)
- Test: `tests/brain-graph.test.ts` (fake `graphify` on PATH that records its argv and env)

**Interfaces:**
- Produces: `graphCommand(opts: { vaultRoot: string; notes: boolean; yes: boolean }): { ran: boolean; message: string }`

- [ ] **Step 0:** Run `graphify --help` and the graphify README's headless and Gemini sections. Find the exact non-interactive command that updates the notes graph through Gemini, using `GEMINI_API_KEY` and `--model`. Record it in a comment in `graph.ts`. If no headless Gemini path exists, `--notes` prints the manual `/graphify . --update` instruction and the file count instead of running anything.
- [ ] **Step 1: Failing tests:**
  - without `--notes` it runs the code-only update and never sets or passes a model
  - `--notes` without `--yes` prints the changed-note count and runs nothing
  - `--notes --yes` without `GEMINI_API_KEY` refuses, with a message saying it will not fall back to Claude (anti-goal: unexpected Claude usage)
  - `--notes --yes` with the key runs the Step 0 command with the configured model
- [ ] **Step 2:** FAIL. **Step 3:** Implement. **Step 4:** PASS. After a successful save, Task 7 runs `graphCommand({notes:true, yes:true})` only when the key is set and the rate limit wasn't hit in this save. Failures become a log note, never a save failure.

### Task 11: Secret guard and template guard

**Files:**
- Create:
  - `.claude/scripts/lib/brain/secrets.ts`, `bin/brain-precommit`
  - `.template-paths` (allowlisted globs for the template repo)
  - `.github/scripts/template-guard.ts`, `.github/workflows/template-guard.yml`
- Test: `tests/brain-secrets.test.ts`, `tests/brain-template-guard.test.ts`

**Interfaces:**
- Produces:
  - `scanForSecrets(text: string): { rule: string; line: number }[]`, covering `AIza[0-9A-Za-z_-]{35}`, `sk-[A-Za-z0-9]{20,}`, `gh[pousr]_[A-Za-z0-9]{36}`, `-----BEGIN [A-Z ]*PRIVATE KEY-----` and `xox[baprs]-`
  - `bin/brain-precommit` uses `gitleaks protect --staged` when gitleaks is installed, else `scanForSecrets` on the staged diff, and exits 1 on a hit
  - `checkTemplatePaths(paths: string[], globs: string[]): string[]`, which returns the offending paths

- [ ] **Step 1: Failing tests:**
  - a fake Gemini key and a GitHub token are detected with their line numbers
  - ordinary prose and hex colours like `#AIzaff` are not flagged
  - `checkTemplatePaths(["work/active/acme/next.md"], globs)` returns that path
  - `checkTemplatePaths([".claude/scripts/brain.ts", "templates/Session.md"], globs)` returns `[]`
- [ ] **Step 2:** FAIL. **Step 3:** Implement. The workflow runs on push and PR, and only when a `.template-repo` marker file exists, so the private brain, which deletes the marker, is unaffected. **Step 4:** PASS.

### Task 12: `setup.sh`, the global install and the README

**Files:**
- Create: `setup.sh`, `docs/brain-setup.md`
- Modify: `README.md` (template intro, the two-repo flow, credits link)
- Test: `tests/brain-setup.test.ts` (runs `setup.sh --non-interactive --no-qmd --no-install` with `HOME` set to a temp dir, the key via stdin, and fake `graphify`, `claude` and `uv` on PATH)

**Interfaces:**
- Consumes: `bin/brain-hook`, `bin/brain-precommit`, `brain.ts`
- Produces: an idempotent setup that does the following:
  - checks WSL and Node ≥ 22 (exits with a message otherwise)
  - installs `uv tool install 'graphifyy[gemini]'` and runs `graphify install` (both skipped under `--no-install`)
  - bootstraps QMD unless `--no-qmd`, and sets `qmdEnabled` to match
  - writes `~/.config/second-brain/.env` (`BRAIN_VAULT=<abs path>`, `GEMINI_API_KEY=<key>`) with mode 600
  - adds one marked `source` line to `~/.zshrc` and `~/.bashrc`
  - merges the brain's hooks into `~/.claude/settings.json` through `bin/brain-hook` for SessionStart, UserPromptSubmit, PostToolUse, PreCompact and Stop, after backing up to `settings.json.bak-<ts>`
  - runs `claude mcp add --scope user om -- node <vault>/.claude/scripts/om-mcp.mjs`
  - writes a marked `<!-- second-brain -->` section in `~/.claude/CLAUDE.md` telling Claude the vault exists and when to use it
  - installs `bin/brain-precommit` as `.git/hooks/pre-commit`
  - adds `bin/` to PATH through the env file
  - prints Obsidian install steps with the `\\wsl.localhost\<distro>\home\<user>\<vault>` path and a `.wslconfig` memory note

- [ ] **Step 1: Failing tests:**
  - after two runs, `settings.json` holds existing user hooks plus exactly one brain entry per event, `.env` has mode 600 and contains the key, the rc files have one source line each, and `CLAUDE.md` has one marked section
  - the key never appears in stdout or stderr
  - the fake `claude mcp add` was called once per run with `--scope user`
- [ ] **Step 2:** FAIL. **Step 3:** Implement. **Step 4:** PASS.
- [ ] **Step 5: End-to-end smoke test** in a temp HOME:
  - set up a template clone with a bare remote, then run setup
  - `brain link` a fake repo
  - run `session-start` through `brain-hook` from that repo and confirm `next.md` is shown
  - `brain save` with a summary and a fake Gemini, done by setting `BRAIN_GEMINI_FAKE=<fixture dir>`, which `gemini.ts` honours only when `NODE_ENV=test`
  - the bare remote has the save commit, and a second clone's session start pulls it

  Record the measured SessionStart output size for a linked repo in `docs/startup-measure.md`.
- [ ] **Step 6:** Write the README sections:
  - "Make your own brain": clone the template, `git remote rename origin template`, create a private repo, `git remote add origin …`, delete `.template-repo`, run `./setup.sh`
  - "Second PC": clone the brain, run `./setup.sh`
  - "Get template updates": `git pull template main`

**Acceptance (whole plan):**
- the full `npm test` passes
- the smoke test passes
- `docs/startup-measure.md` has the before, after and linked-repo numbers
- every spec Goal (1–10) maps to a task above: 1 is Tasks 3 and 5, 2 is Task 6, 3 is Tasks 5 and 9, 4 is Task 8, 5 is Task 7, 6 is Task 4, 7 is Task 12, 8 is Task 10, 9 is Tasks 2, 3 and 12, and 10 is Task 11
