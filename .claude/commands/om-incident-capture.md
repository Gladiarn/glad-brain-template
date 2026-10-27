# Production Bug and Outage Capture

Capture a production bug or outage into structured vault notes: what broke, why, and the fix. Produces a complete incident note with timeline, root cause, resolution, and the lesson, plus a portfolio entry when the fix is worth showing.

## Usage

```
/om-incident-capture <description, links, logs, or "this session">
```

Provide whatever evidence exists: the owner's account of what happened, error logs, deploy or hosting status pages, commit SHAs or PR links, client emails or messages pasted in, monitoring alerts. The more context, the better. "this session" means capture what happened in the current conversation.

## Subagents

- **`client-profiler`** — optional; creates or updates the client and contact notes for anyone involved, from vault notes and what the owner says (use it only when the client or contact notes are missing)

## Workflow

### 1. Gather Raw Data

For each source provided:
- Read the logs, links, commits, or pasted messages in full
- `git log` the affected repo around the incident window when the repo is available
- Note every timestamp, person, and message — nothing is too small
- Examine any screenshots or files shared

### 2. Identify Who Was Involved

For every client or person who reported, was affected by, or helped with the incident:
- Check if they have a note in `clients/` or `clients/contacts/`
- Note their role and what they reported or decided
- Track who did what (reported, investigated, fixed, confirmed)

### 3. Build the Timeline

Reconstruct a detailed timeline from all sources:
- Every event with an exact timestamp and the timezone
- Attribution: who said or did what
- Cross-reference between sources (the same event may be described differently in a client email and in the deploy log)
- Key moments: first report, incident declared, root cause identified, fix created, fix deployed, resolution confirmed

### 4. Create the Incident Note

Create `work/incidents/<Incident Name>.md` with:

```yaml
---
date: "YYYY-MM-DD"
quarter: QN-YYYY
description: "~150 chars"
project: <relevant project>
client: <client, if any>
status: active
ticket: <issue or PR number, or "none">
severity: high/medium/low
role: <your role, e.g. owner, on-call, contractor>
tags:
  - work-note
  - incident
---
```

Sections:
- **Context** — what broke, what triggered it, who was affected
- **Root Cause** — technical explanation
- **Resolution** — the fix (commit or PR), what changed
- **Timeline** — full detailed table with timestamps
- **Impact** — users affected, revenue or client impact, duration
- **Involved** — with wikilinks to client and contact notes
- **Prevention** — what stops it happening again (test, monitoring, a deploy check)
- **Related** — wikilinks to all related notes, the project, and craft areas

### 5. Create/Update Client and Contact Notes

For people involved who don't have notes, create them in `clients/contacts/` with proper frontmatter (`date`, `title`, `description`, `company`, `tags: [person]`) and add them to `clients/Clients.md`.

For existing notes, add the incident as a Key Moment.

### 6. Update Indexes

- `work/Index.md` — add to the Incidents section
- `work/active/<project>/next.md` — add anything left to do (monitoring, follow-up) under What To Do Next
- `brain/Memories.md` — add incident summary to Recent Context
- `brain/Patterns.md` — if this reveals a recurring pattern
- `brain/Gotchas.md` — if this reveals a technical gotcha (this is the main durable output)
- `portfolio/Portfolio.md` — add to the relevant quarter when the fix shows reliability work worth showing

### 7. Prepare a Post-Mortem Draft (if applicable)

If the incident hit a client and they will want an explanation:
- Create `work/incidents/<Incident Name> Post-Mortem Draft.md`
- Include: Executive Summary, Narrative Timeline, 5 Whys analysis, Action Items table
- Write it blamelessly: facts and fixes, plain language the client can read

### 8. Offer Next Steps

After capturing, suggest:
- "Want me to draft the message to the client?"
- "Want me to add a test or a monitor so this can't recur silently?"
- "Should I run `/om-vault-audit` to verify everything links properly?"

## Important

- **Read every message and log line** — don't skim or summarize prematurely
- **Preserve exact timestamps** — incident timelines need precision
- **Attribute everything** — who said what, who did what
- **Cross-reference** — the same event may look different in a client email and in the logs
- **Mark inference** — a cause not yet verified carries `(TBC)`
- **Be blameless in anything shared** — use commit SHAs, not names, in documents a client will read
