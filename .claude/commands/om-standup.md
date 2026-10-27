---
description: "Morning kickoff and plan for today. Reads the current project's plan and tasks from the session injection, reviews yesterday, surfaces open tasks, and identifies priorities."
---

Run the morning standup.

**Start from the SessionStart injection — do NOT re-read what it already carries.** The hook has already injected: **the current project's plan for today** (its `next.md` and open tasks, under `Plan for today`), the North Star excerpt, active work, recent git changes, open tasks, hygiene flags (incl. open loops), and the file listing. Re-reading `Home.md`, `brain/North Star.md`, or re-running `git log` doubles the token cost for zero new information.

**"What's the plan for today?" is answered from the injected `Plan for today` section first.** Open another file only when that section lacks something the answer needs. If it says there is no plan yet, say so and offer to write `work/active/<project>/next.md` from the `Project Next` template.

Gather only what the injection does NOT have:

1. Read yesterday's and today's daily notes if they exist: `obsidian daily:read`. If the `obsidian` CLI is missing or Obsidian is closed (the CLI may not be reachable from WSL), read the files directly: the folder is `folder` in `.obsidian/daily-notes.json` (vault root when unset), the names are `YYYY-MM-DD.md`; if none exist, skip this step
2. List daily-note tasks: `obsidian tasks daily todo`, or without the CLI grep the daily notes from step 1 for unchecked boxes (`- [ ]`). The injected Open Tasks section covers checkbox tasks in active notes and the vault root — this adds daily-note tasks
3. Read `work/Index.md` ONLY if the injected active-work list needs status detail the summary will actually use
4. Check for unprocessed inbox items (`work/meetings/` raw exports — the hygiene flags name them when they age)

Present a structured standup summary:
- **Plan for Today**: the current project's `What To Do Next`, blockers, and open tasks, as injected
- **Yesterday**: What got done (from the injected Recent Changes + daily note)
- **Active Work**: Current projects in work/active/ with their status
- **Open Tasks**: Pending items
- **Open Loops**: stale follow-ups from the injected hygiene flags — anything to chase today?
- **North Star Alignment**: How active work maps to current goals
- **Suggested Focus**: What to prioritize today based on goals + open items — act on injected hygiene flags here

Keep it concise. This is a quick orientation, not a deep dive.
