# Subagents (Claude Code)

Claude-only: Claude Code loads this file beside `AGENTS.md` and the shared files in this folder, which hold every convention the other agents share.

| Folder | Purpose | Key Files |
|--------|---------|-----------|
| `.claude/agents/` | Subagents | See subagents table below |

## Subagents

Specialized agents in `.claude/agents/` for heavy operations. They run in isolated context windows.

| Agent | Purpose | Invoked by |
|-------|---------|------------|
| `portfolio-spotter` | Finds uncaptured wins and craft-area gaps | `/om-wrap-up`, `/om-weekly` |
| `client-profiler` | Creates/updates client and contact notes from vault notes and what you tell it | `/om-incident-capture`, direct |
| `context-loader` | Loads all vault context about a client, project, or concept | Direct |
| `correction-sweep` | Finds every note restating a corrected fact; classifies each as authoritative, restatement, or historical. Never edits | `/om-correct` |
| `cross-linker` | Finds missing wikilinks, orphans, broken backlinks | `/om-vault-audit` |
| `vault-librarian` | Deep vault maintenance -- orphans, broken links, stale notes | `/om-vault-audit` |
| `vault-migrator` | Classifies, transforms, and migrates content from a source vault | `/om-vault-upgrade` |

