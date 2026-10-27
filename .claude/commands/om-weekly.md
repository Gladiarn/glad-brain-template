---
description: "Weekly synthesis — cross-session review of vault activity, North Star alignment, patterns, uncaptured wins, and forward priorities."
---

Cross-session synthesis of the past week. Bridges daily standup (lightweight) and a quarterly portfolio update (comprehensive). This is ANALYSIS, not verification — find patterns, surface drift, detect uncaptured work.

## Subagent

- **`portfolio-spotter`** — run with weekly scope to find uncaptured wins and craft-area gaps

## Workflow

### 1. Gather Week's Activity

Automated — no user input needed:

- `git log --since="7 days ago" --oneline --no-merges` — all vault changes
- List all notes modified in the past 7 days (git + filesystem)
- Read any client meeting notes from this week (`work/meetings/`, `clients/`, and dated notes in `work/active/`)
- Check `work/active/` for status changes
- Check `work/incidents/` for new or updated incidents
- Read today's daily note if it exists: `obsidian daily:read`. If the `obsidian` CLI is missing or Obsidian is closed (the CLI may not be reachable from WSL), read the files directly: the folder is `folder` in `.obsidian/daily-notes.json` (vault root when unset), the names are `YYYY-MM-DD.md`; if none exist, skip this step

### 2. North Star Alignment

Read `brain/North Star.md` and compare actual activity against stated focus:

- **Aligned work**: which Current Focus items got attention this week?
- **Drift**: work that doesn't map to any stated goal (not necessarily bad — flag it)
- **Silent goals**: focus items with zero commits, zero note updates, zero mentions
- **Emerging themes**: work patterns suggesting a focus shift that hasn't been written down yet

### 3. Cross-Day Patterns

Look across the week's notes for:
- Recurring themes (same topic in multiple notes or days)
- Multiple incidents or issues touching the same system
- Topics appearing in BOTH work notes and client meetings (these are signals)
- Context that evolved across sessions (decisions that shifted, understanding that deepened)

### 4. Uncaptured Win Detection

Run the `portfolio-spotter` subagent with its standard (quarterly) scope, then filter its findings down to wins that clearly occurred in the past 7 days.

Additionally check:
- Were completed items logged in `portfolio/Portfolio.md` or the current quarter's wins note?
- Any client feedback or kudos not captured?
- Production fixes worth showing that were not logged?

### 5. Craft-Area Signal Mapping

For each craft area in `portfolio/competencies/`:
- Was it exercised this week? (check work note links, incident roles, client meeting topics)
- If yes, is the craft area explicitly linked from the evidence note?

Present as a compact table: craft area name, exercised (yes/no), linked (yes/no).

### 6. Hygiene Sweep

Act on the current vault-hygiene flags (the SessionStart/Stop scan): archive completed-not-archived notes, group genuine clusters, split oversized notes, and list stale open loops for the user to chase or park. This is `/om-tidy`'s mechanical tier on a schedule — invoke `/om-tidy` directly for the full pass with its report.

### 7. Forward Look

- Blocked items or upcoming deadlines from active work notes
- North Star goals that need attention next week
- Scheduled client calls or meetings worth preparing for (`/om-meeting <client>`)
- Suggested priority ordering for next week based on goals + momentum + gaps

### 8. Present Synthesis

Structure the output as:

- **This Week**: 3-5 bullet summary of what actually happened
- **North Star Check**: alignment status — what's on track, what drifted, what's silent
- **Patterns**: cross-day themes worth noting
- **Uncaptured Wins**: anything that should be in the portfolio (from portfolio-spotter)
- **Craft-Area Coverage**: compact table
- **Next Week**: suggested priorities and attention areas

After presenting, offer:
- "Want me to add any of these wins to the portfolio?"
- "Should I update North Star with any focus shifts?"
- "Want me to save this as `thinking/weekly-YYYY-MM-DD.md`?"

## Important

- This is transient analysis by default — do NOT create a file unless the user asks.
- Keep the tone analytical, not cheerful. This is a status check, not a celebration.
- Be honest about drift and silent goals — the value is in surfacing what's NOT happening, not just what is.
- Don't duplicate standup (daily, what's next) or wrap-up (session, verify quality). This is SYNTHESIS across days.
- If it was a light week (few commits, no new notes), say so. Don't pad the analysis.
