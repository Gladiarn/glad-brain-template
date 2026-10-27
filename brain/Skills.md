---
date: 2026-04-07
description: "Vault-specific workflows and slash commands — reusable patterns for client meetings, project tracking, and vault maintenance"
tags:
  - brain
  - index
---

# Skills

Custom slash commands, subagents, and reusable workflows. Defined in `.claude/commands/` and `.claude/agents/`. **This note is the canonical command catalog** for agents that don't get the in-session skills injection (Codex, Gemini, Cursor) — keep it current when commands change; AGENTS.md deliberately carries no command table.

## Slash Commands

### Daily Workflow

| Command | Purpose |
|---------|---------|
| `/om-standup` | Morning kickoff — load context, review yesterday, surface tasks, identify priorities |
| `/om-dump` | Freeform capture — dump anything, gets routed to the right notes automatically |
| `/om-wrap-up` | Full session review — verify notes, indexes, links, suggest improvements. Auto-triggered on "wrap up". |

### Editing & Synthesis

| Command | Purpose |
|---------|---------|
| `/om-humanize` | Voice-calibrated editing — makes Claude-drafted text sound like you wrote it |
| `/om-weekly` | Weekly synthesis — cross-session patterns, North Star alignment, uncaptured wins |

### Client Meetings & Incidents

| Command | Purpose |
|---------|---------|
| `/om-meeting` | Prep for a client meeting by topic or client — subject-forward briefing with open items, chronic loops, wins to share, and brainstormed considerations. `/om-meeting capture <client>` files the notes afterwards with takeaways, decisions, action items, and quotes |
| `/om-intake` | Process client meeting notes inbox — classify raw exports in `work/meetings/` and route to the right vault notes |
| `/om-incident-capture` | Capture a production bug or outage into structured vault notes — timeline, root cause, fix, prevention, portfolio entry |

### Vault Maintenance

| Command | Purpose |
|---------|---------|
| `/om-correct` | Sweep a corrected fact through the vault — semantic + literal search, applies at the single source, replaces restatements with links, preserves notes recording what was believed at the time. The acting half of Write-Correctness Law 2 |
| `/om-vault-audit` | Deep structural audit — indexes, frontmatter, links, Bases, folder placement, stale context |
| `/om-vault-upgrade` | Upgrade this vault through ShardMind, keeping local improvements and listing them as upstream candidates; or import content from an existing vault — detects version, classifies notes, transforms frontmatter, rebuilds indexes |
| `/om-project-archive` | Move completed project from `work/active/` to `work/archive/YYYY/`, update all indexes — moves whole `active/<Topic>/` clusters intact |
| `/om-tidy` | Self-maintenance pass — acts on every hygiene flag: archives completed work, groups clusters, splits oversized notes, reports open loops. Never deletes, never commits |

## Usage Notes

**Daily:**
- `/om-standup` replaces the manual session start — reads North Star, active work, tasks, git log
- `/om-dump` processes freeform text and routes each piece to the correct note type and folder
- `/om-wrap-up` is auto-triggered when you say "wrap up" — runs full session review

**Editing & Synthesis:**
- `/om-humanize` calibrates against your actual writing samples, not a word blacklist. Detects context from frontmatter and folder (portfolio and client-facing → confident, incident → precise, meeting → conversational). Run after drafting any note to make it sound human.
- `/om-weekly` bridges standup and the portfolio — run at end of week for cross-session patterns, North Star drift, and uncaptured wins. Output is transient by default; offer to promote findings to the portfolio or North Star.

**Capture:**
- `/om-meeting capture <client>` handles transcripts, raw notes, or summaries of a client call
- `/om-incident-capture` takes logs, commits, and messages and produces structured incident documentation

**Maintenance:**
- `/om-vault-audit` should be run at the end of substantial sessions — catches stale indexes and mixed context
- `/om-vault-upgrade` with no source upgrades this vault through ShardMind 0.2.1+: `upgrade-plan.ts` sorts every differing file into behind (take), ahead (keep; upstream candidate), merged or conflict before anything is applied. With a source, it imports content from an existing vault (older obsidian-mind or any Obsidian vault). Detects version, classifies notes, transforms frontmatter, fixes wikilinks, rebuilds indexes. Use `--dry-run` to preview.
- `/om-project-archive` handles the active/ → archive/ move with index updates

## Subagents

| Agent | Purpose | Invoked by |
|-------|---------|------------|
| `portfolio-spotter` | Proactively finds uncaptured wins and craft-area gaps | `/om-wrap-up`, `/om-weekly` |
| `client-profiler` | Creates/updates client and contact notes from vault notes and what you tell it | `/om-incident-capture`, direct |
| `context-loader` | Loads all vault context about a client, project, incident, or concept | Direct — "load context on X" |
| `cross-linker` | Finds missing wikilinks, orphans, broken backlinks across the vault | `/om-vault-audit` |
| `vault-librarian` | Deep vault maintenance — orphan detection, broken links, frontmatter validation, stale notes | `/om-vault-audit` |
| `vault-migrator` | Classify, transform, and migrate content from a source vault | `/om-vault-upgrade` |

Subagents run in isolated context windows via `.claude/agents/`. They don't pollute the main conversation.

## Hooks

| Hook | When | What |
|------|------|------|
| SessionStart | On startup/resume | QMD re-index, inject North Star, active work, recent changes, tasks, file listing |
| UserPromptSubmit | Every message | Classify content (decision, incident, client meeting, win, architecture, person, project update) and inject routing hints |
| PostToolUse | After writing `.md` | Validates frontmatter, checks for wikilinks |
| PreCompact | Before context compaction | Back up session transcript to `thinking/session-logs/` |
| Stop | After every response | Checklist + hygiene findings, once per session and again when they change, to the user and to the agent (which decides whether to act); ask the agent to run `om-tidy` to act |

## Semantic Search (QMD)

If QMD is installed (`npm install -g @tobilu/qmd`), the vault has semantic search. Every command takes `--index <name>`, where `<name>` is `vault-manifest.json`'s `qmd_index` field when set and otherwise the vault folder name slugified:

- `qmd --index <name> query "..."` — hybrid BM25 + vector + LLM reranking (best quality)
- `qmd --index <name> search "..."` — fast BM25 keyword search
- `qmd --index <name> vsearch "..."` — semantic vector search (exploratory)
- `qmd --index <name> update && qmd --index <name> embed` — refresh index after bulk changes

SessionStart hook runs `qmd --index <name> update` automatically, reading the index name from the manifest. First-time setup on a fresh clone: `node --experimental-strip-types .scripts/qmd-bootstrap.ts`. See `.claude/skills/qmd/SKILL.md` for full reference, and [[Memories]] for the topics QMD is most often asked to find across the vault.

## The `om` MCP Server (reaching this vault from another repo)

`.claude/scripts/om-mcp.mjs` exposes this vault over MCP so a session in **another repository** can use it. Registered in the *consuming* project's `.mcp.json`, never in this vault's own — the server refuses a memory write from a session running inside the vault, because such a memory would be scoped to the vault-as-a-project and reach only sessions that already read every note directly.

| tool | purpose |
|------|---------|
| `search` | semantic + keyword over the notes this vault serves |
| `expand` | a note's links out and backlinks |
| `recall` | durable lessons scoped to the calling repo, most specific first; `explain: true` reports what was withheld and why. A capture whose `promoted:` marker carries an anchor serves the promoted `brain/` block instead of the capture body, so you read the corrected version |
| `remember` | record a lesson that generalises beyond this repo |
| `record_work` | record what happened here, filed where it belongs |
| `reason` | judgement across several notes, by reading the vault with a second Claude session |
| `health` | where memories live, which roots are exposed, is the index reachable |

Two prompts you invoke yourself from the `/` menu: `recall_topic`, `prior_art`. They must be **selected** from the menu — typing the displayed label errors.

**`reason` is the slow one.** The rest answer without inference; this one spawns a session, so it takes seconds to minutes. Reach for it when `search` or `recall` returned the notes but not the answer — it seeds itself from search, so there is no need to search first. It runs on your own CLI default model unless `reason.model` pins one, nothing about it is capped, and every call is logged with its cost, turns, model and wall time. Answers land in `.claude/om-reasoning/` marked `confidence: inferred` and are never auto-recorded as memories.

**Debugging it:** call `health` first. Every failure in this layer presents identically as "no results" — a renamed memory folder, a moved launcher, an index registered to a different vault, a session with no identity — and `health` is what tells them apart. A caller reported as `ANONYMOUS` means the client never completed the roots handshake, so only `general`-scope memories are visible.

**Two guards worth knowing:** memories are never served as ordinary notes (they carry their own declared scope), and a memory that would reach nobody is refused rather than silently widened to `general`.

Full setup, which notes the server serves, and the required repo-side snippet: `.claude/rules/vault-from-another-repo.md`. How the whole layer works — the four MCP surfaces, the identity handshake, a `search` call end to end, memory-visibility evaluation, the write path: `ARCHITECTURE.md` § *Reaching the Vault From Another Repo*.

## Workflow: Weekly Review

1. **`/om-weekly`** — synthesize the week's activity, check alignment, find patterns
2. Promote any uncaptured wins to the portfolio
3. Update North Star if focus shifted
4. **`/om-wrap-up`** — close the session cleanly

## Workflow: Client Meeting

1. **`/om-meeting <client or topic>`** — brief yourself before the call: open items, chronic loops, wins to share, considerations
2. Take the meeting
3. **`/om-meeting capture <client>`** — file the notes, update the client note and the project's `next.md` and `tasks.md`
4. **`/om-vault-audit`** — tidy up after a lot of new data

## Workflow: Project Ramp-Up

1. Read the client note in `clients/` and the project folder in `work/active/`
2. **`/om-meeting <project>`** — brief yourself on what is open and what could go wrong
3. Create `next.md` and `tasks.md` for the project from the context gathered
4. **`/om-vault-audit`** — ensure everything links properly
