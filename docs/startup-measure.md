# Startup measure

How much a session loads before the first message. Numbers are bytes.

## Baseline tests

obsidian-mind v10.0.0 at import: 2252 tests, 2235 pass, 17 skipped, 0 fail (`cd .claude/scripts && npm test`).

The only failure on the raw merge was this repo's own design spec, whose `Date:` and `Status:` lines were one paragraph. I separated them with a blank line so the vault's prose-width gate passes.

## Before

- `AGENTS.md`: 21289
- `.claude/rules/*.md`: 24652 (10 files, none path-scoped)
- Instruction files total: 45941
- SessionStart hook output in the vault (`session-start.ts </dev/null`): 2353 (the hook JSON; vault was nearly empty at import time)

## After (Task 2)

- `AGENTS.md`: 21731 (up 442: it now documents the per-project `next.md` and `tasks.md`, clients and portfolio folders; the corporate review, 1:1 and Slack rows are gone)
- `.claude/rules/*.md` always loaded: 8843 (6 files, was 24652 across 10; 205 of it is the plan-for-today line added in session-workflow.md)
- Instruction files always loaded: 30574 (was 45941, saving 15367)
- `.claude/rules/*.md` now path-scoped, loaded only when matching files are read: 16330 (4 files, content unchanged apart from a `paths:` frontmatter block)
- SessionStart hook output in the vault: 3367 (includes the general project's plan, which is the plan-for-today block)

What changed, one line each:

- Removed the commands `om-review-brief`, `om-review-peer`, `om-self-review`, `om-slack-scan`, `om-peer-scan`, `om-capture-1on1`, `om-prep-1on1`, their Gemini wrappers, and the agents `review-prep`, `review-fact-checker`, `slack-archaeologist`.
- Folded the 1:1 prompt text (carry-forward check, wins to share, note structure) into `om-meeting`, which now also captures meetings.
- Removed the `1-1 History` and `Review Evidence` bases and the `Review Template` note template.
- Scoped `hooks-and-mod.md`, `hooks-per-agent.md` to `.claude/settings.json`, `.claude/scripts/**`, the mod folder, `.codex/**` and `.gemini/**`.
- Scoped `vault-from-another-repo.md` to `.mcp.json`, the `om` MCP server files and `memories/**`.
- Scoped `obsidian-cli.md` to `bases/**`, `.obsidian/**`, `*.base` and `*.canvas` files.

## Linked repo (Task 12)

A session in a linked code repo loads none of the vault's AGENTS.md or rules, and none of the vault listing, QMD work or hygiene scan. It gets the global CLAUDE.md section (936 bytes) and one SessionStart block from `bin/brain-hook`:

- Fresh project, template plan only: 347 bytes (measured by `tests/brain-smoke.test.ts`).
- Realistic project, a plan with 8 next steps, 16 lines of context and 12 open tasks: 2933 bytes.
- Ceiling: the plan block is cut at 3500 bytes with a cut marker, so the block cannot grow with the vault or with the number of projects.
