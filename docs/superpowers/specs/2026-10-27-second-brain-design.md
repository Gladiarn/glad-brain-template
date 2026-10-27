# Second Brain — Design

Date: 2026-10-27
Status: Approved by owner 2026-10-27

## Intent

A web developer and web designer wants Claude Code to remember project state across sessions and across two PCs. Today they end sessions with "update stuff so next session remembers it" and start the next one with "what's the plan for today?". They will run many projects (client sites, design work, personal) plus general knowledge, and expect that number to keep growing for years.

Two GitHub repositories:

1. **Template repo (public)**: a reusable second-brain vault anyone can clone. No personal data.
2. **Brain repo (private)**: the owner's instance, made from the template and holding their data. They clone it on each PC so both have the same brain. It pulls template improvements without touching the data.

## Basis

Build on **obsidian-mind** (github.com/breferrari/obsidian-mind, MIT, v10.0.0, released 2026-10-12, about 5.4k stars). The owner likes its setup and wants to **stay close to it**. Changes should be additive or renames. Rewrites are out.

Also borrow, with credit:

- **BrineWR71/obsidian-project-vault-template** (MIT): the project, session and decision note templates, and the "Next Session Prompt" format (Completed / Blocked / Do Next / Key Context / Success Criteria).
- **graphify** (Graphify-Labs/graphify, Apache-2.0, CLI 0.9.96, already installed globally on this PC): a knowledge graph for questions that span projects.

## Goals

1. **Plan for today, per project.** Starting a session in any project repo loads that project's current plan automatically. Asking "what's the plan for today?" answers from it without extra searching.
2. **`save` trigger.** A message that is exactly `save` saves the session's progress for the current project. A message starting with `save:` saves that one item. `wrap up` keeps obsidian-mind's full end-of-session review. Detection happens in the existing UserPromptSubmit hook (`classify-message.ts`), not only as a written instruction, so it fires reliably in long sessions. Normal sentences containing "save" ("add a save button") must not trigger it.
3. **Half-automatic memory.** Keep obsidian-mind's automation: SessionStart context, per-message classification hints, write validation, PreCompact, the Stop checklist, and wrap-up. Add a reminder when the previous session in the current project was never saved. It offers to save and never writes without consent.
4. **Same brain on both PCs.**
   - Every session start runs `git pull` on the brain automatically.
   - Every `save` and `wrap up` commits and pushes automatically.
   - Failures (offline, conflict) warn and never block the session. Conflicts are shown to the owner and never auto-resolved by overwriting.
   - A later save retries a push that failed.
5. **Gemini does the filing, Claude is the fallback.** A save works like this:
   - Claude produces a short structured summary of the session. This is cheap because the context is already loaded.
   - Gemini merges the summary into the vault notes: write, then a self-check pass (anything lost, invented, duplicated or filed to the wrong project?), then a fix. At most 2 check/fix rounds.
   - A plain-script sanity check runs afterwards. For example, it rejects a write that deletes a large share of an existing note.
   - If Gemini is down, rate-limited, or fails its check twice, the save falls back to a Claude **Sonnet** subagent and says so ("saved via Claude: Gemini unavailable").
   - Every save is logged with the model used, token counts and the outcome.
6. **One-step project wiring.** A `brain link` command, run once per code project, does both steps obsidian-mind requires:
   - registers the `om` MCP server in that project's `.mcp.json`
   - adds the vault instruction section to that project's `CLAUDE.md`

   It also records which vault project the repo maps to.
7. **New-PC setup.** `setup.sh` in the brain repo:
   - installs dependencies: Node 22+, graphify via `uv tool install 'graphifyy[gemini]'`, `graphify install`, and QMD as optional
   - asks once for the Gemini API key and stores it in `~/.config/second-brain/.env`, chmod 600 and outside the repo
   - loads that file into the shell
   - leaves the vault ready to use, with the committed graph already present
8. **graphify integration.**
   - Notes go through Gemini.
   - Code-only rebuilds (free) are the default.
   - Any rebuild that would send notes to an LLM states the file count and asks first.
   - `graphify-out/graph.json` is committed so the other PC never rebuilds it unnecessarily.
   - The first full build of notes may span days because of free-tier limits. It relies on graphify's cache to resume.
9. **Scales and lasts.**
   - Startup loads only the index plus the current project, whatever the vault size.
   - Archived projects leave the index but stay searchable.
   - Model names live in one config file.
   - `AGENTS.md` stays agent-agnostic, as obsidian-mind already makes it.
   - The template upgrade path keeps working: obsidian-mind upstream flows into the template, and the template flows into the brain.
   - A vault version number plus migrations handle structure changes.
10. **Secret guard.** A pre-commit check (gitleaks or equivalent) blocks any brain commit containing API keys or tokens. This protects against `.env` contents leaking into notes, and against personal data reaching the public template.

## Repurpose, don't delete

obsidian-mind is aimed at a corporate engineer. Every part was reviewed for a web dev and designer. Parts are renamed or repurposed. Only the ones with no plausible use are removed.

| obsidian-mind | Becomes |
|---|---|
| `org/` people & teams, `people-profiler` | `clients/`: client profiles, preferences, contacts, past projects |
| `perf/` brag doc, competencies, `brag-spotter` | `portfolio/`: wins, case studies, before/after results |
| `work/meetings/`, `om-meeting`, `om-intake` | Client meetings and calls |
| `work/1-1/`, `om-capture-1on1`, `om-prep-1on1` | Folded into client meetings; separate 1:1 flow removed unless the builder finds a use |
| `work/incidents/`, `om-incident-capture` | Production bugs and outages: what broke, why, and the fix |
| `om-standup` | Kept, and becomes the "plan for today" flow, scoped to the current project's `next.md` |
| `om-review-brief`, `om-review-peer`, `om-self-review`, `review-prep`, `review-fact-checker` | Removed (corporate performance reviews) |
| `om-slack-scan`, `om-peer-scan`, `slack-archaeologist` | Removed (no Slack workflow) |
| Everything else (`brain/`, `om-wrap-up`, `om-tidy`, `om-correct`, `om-dump`, `om-humanize`, `om-weekly`, `om-project-archive`, `om-vault-audit`, `om-vault-upgrade`, the agents `context-loader`, `cross-linker`, `correction-sweep`, `vault-librarian`, `vault-migrator`, all skills, QMD) | Kept as is |

The `qmd_context` string and the starter content (North Star prompts, Home.md) are rewritten for a web dev and designer.

## Per-project structure (added)

Each active project gets a folder under `work/active/<project>/`:

- `next.md`: the current plan in the BrineWR71 Next Session format. It is **updated in place**, never appended to, so it always reads as the current state.
- `tasks.md`: open and done tasks.
- `decisions.md`: or links to decision notes using the BrineWR71 Decision template.
- Session notes (BrineWR71 Session template), optional.

`work/Index.md` lists active projects one line each. `om-project-archive` moves a finished project to `work/archive/` and removes its line from the index.

## Startup cost

Measured on obsidian-mind v10: `AGENTS.md` (21 KB) plus `.claude/rules/` (25 KB, none of it path-scoped) load every session, about 46 KB or 12k tokens.

The owner's rule: **fewer tokens is not the goal by itself, and nothing useful may be dropped to get there.** Savings come only from:

- removing the corporate-only rules and commands listed above
- path-scoping rules that apply to specific folders, so they load when those folders are touched

Startup must still carry everything needed for a good session in the current project. Measure before and after, and report both.

## Gemini

- **Model:** `gemini-3.8-flash`, the best model on the free tier according to Google's pricing page on 2026-10-27. It is set in one config value.
- **Tier:** free. The owner accepts that Google may use free-tier content to improve its products, including client project notes. There is no per-project private mode.
- **Rate limits:** Google's per-project limits are unpublished. Third-party figures range from 20 to 1,500 requests a day. One save is 2–4 requests. Running out triggers the Claude fallback, not an error.
- The key is never committed.

## Non-goals

- Fully automatic capture that saves sessions without the owner saying `save` or `wrap up`. It was considered and deferred. The unsaved-session reminder covers the gap.
- A per-project privacy mode.
- Paid Gemini models.
- Replacing obsidian-mind's architecture, TypeScript hooks or MCP server.

## Anti-goals

These count as failure even if everything technically works:

- A bad save silently corrupts or loses notes.
- The two PCs drift apart without the owner knowing.
- An API key ends up in git.
- The template repo contains any of the owner's data.
- A graphify or save operation burns the owner's Claude usage unexpectedly. This happened before, when a graphify update consumed 100% of the usage.
- Diverging so far from obsidian-mind that upstream updates can no longer be merged.

## Constraints

- **Environment:** both PCs run Windows with WSL2. This PC uses zsh, and has `uv` 0.12.24 and graphify 0.9.96 installed. `setup.sh` and the hooks therefore target WSL/Linux only, and native Windows is out of scope. Obsidian is not installed on either PC yet. `setup.sh` should tell the owner to install the Windows Obsidian app, since it cannot install it from WSL.
- **Vault location:** the vault lives on the WSL filesystem (for example `~/brain`), where git, Claude Code and the Node hooks run fast. The Windows Obsidian app opens it at `\\wsl.localhost\<distro>\home\<user>\brain`. Obsidian is used as the viewer and editor.
- **Obsidian CLI:** the Obsidian CLI may not be reachable from WSL. Every kept command that calls `obsidian ...` (for example `om-standup`'s `obsidian daily:read` and `obsidian tasks`) needs a filesystem fallback, and must work with Obsidian closed. obsidian-mind already prefers filesystem reads when Obsidian isn't running. Follow that pattern.
- **graphify has two jobs, following the common community split** (lucasrosati/claude-code-memory-setup, about 1k stars, MIT; eric-orozco's guide):
  - **(a) In each linked code repo:** graphify builds a code graph. It is AST only, so it is free. `brain link` runs the first code-only build. Claude queries it for "how is this code structured?" so it doesn't grep and read whole files.
  - **(b) In the vault:** a notes graph, extracted through Gemini, for connections across projects, clients and lessons.

  Obsidian holds what was decided. graphify holds how things connect.
- **Do not let `graphify --obsidian` write into the owner's notes.** That export regenerates one note per node from scratch on each run and overwrites hand edits. If it is used at all, it goes to its own throwaway folder that is excluded from QMD, graphify and git, or is replaced by the graphify-visualizer plugin.
- **graphify is an addition.** obsidian-mind has no graphify integration (0 mentions in v10). Its search is QMD (semantic search, optional, about 2.3 GB of local models, falls back to grep). graphify is added alongside it for graph queries: connections across projects, clients and lessons. Its integration points are the global hook (`graphify claude install`-style query-first guidance) and the `om` MCP server's `expand` and `search`.
- **Licensing:** obsidian-mind and BrineWR71 are MIT, so their license notices are kept. graphify is Apache-2.0.
- **Dependencies:** obsidian-mind requires Obsidian 1.12+ (CLI enabled) and Node 22+.
- **Git authorship:** follows the owner's global rules. Commits use conventional format, with no AI attribution anywhere.

## Decisions made after the builder check (Claude's calls; owner may override)

- **Hooks are global, not per repo.** obsidian-mind's hooks live only in the vault's `.claude/settings.json` and do not fire in code repos. `setup.sh` installs the brain's hooks (SessionStart, UserPromptSubmit, Stop and the rest) in the user-global `~/.claude/settings.json`. It also registers the `om` MCP server at user scope. Each hook does nothing unless the session runs in the vault or in a linked repo. Hooks run from the vault path recorded in `~/.config/second-brain/.env`.
- **No files are written into code or client repos.**
  - `brain link` adds one entry to a map file inside the brain, `projects.map`, keyed by the repo's **git remote URL**. The same entry therefore resolves on both PCs whatever the local path.
  - The vault instruction section goes in the global `~/.claude/CLAUDE.md`, written by `setup.sh`. It is not added to each repo's `CLAUDE.md`.
  - Client repos shared with clients never reveal the brain.
  - Repos without a remote fall back to a path-keyed entry, marked machine-local.
- **Non-code work** (design work, general knowledge) runs in sessions started in the vault. A `general` project exists for it.
- **What `save` may write:**
  - the current project's folder (`next.md`, `tasks.md`, decisions, sessions)
  - its line in `work/Index.md`
  - `brain/` lessons (Gotchas, Patterns, Key Decisions)
  - the linked client note in `clients/`

  Nothing else. The sanity check and the wrong-project check cover exactly these files. Broader changes are left to `wrap up` / `om-wrap-up` and `om-tidy`.
- **Template workflow:**
  - Template changes are developed in the public template repo, never in the brain.
  - The template repo is a fork of obsidian-mind with `upstream` as a git remote. Upstream releases merge in with git.
  - The brain is a clone of the template with the template as a git remote (shared history), so template updates reach the brain through `git pull template main`.
  - A CI check on the template repo fails any commit that touches paths outside an allowlist of infrastructure paths, which keeps the owner's notes out of the template.

## Left to the builder

- How the template stays mergeable with obsidian-mind upstream despite the folder renames. Options include a fork with an upstream remote, renames via config or the manifest, or a documented merge procedure.
- How the current project is detected from the session's working directory, and where the repo-to-project map lives.
- Exact save summary schema and Gemini prompts for the write and check passes.
- The size threshold for the sanity check.
- How the unsaved-session reminder knows a session was unsaved, for example a marker written by `save` compared against the transcripts on disk.
- Whether `brain link` is a shell script, an npm script, or an obsidian-mind command.
- The weekly tidy schedule: manual `om-tidy`, or a scheduled run that uses Gemini.

## Search: QMD on (decided)

QMD, obsidian-mind's local semantic search, stays **on**, as obsidian-mind ships it:
- It costs no tokens, and obsidian-mind's `om` MCP search is built on it.
- `setup.sh` installs it and builds the index on each PC. The index is per machine and not committed.
- Known risk: this PC's WSL has 7 GB of RAM. One config switch must turn QMD off, so search falls back to grep, and `setup.sh` should mention the `.wslconfig` memory setting.

The stack is obsidian-mind + QMD + graphify.
