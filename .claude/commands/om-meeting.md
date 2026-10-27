---
description: "Prep for a client meeting or call by topic or client — subject-forward briefing with open tasks, blockers, and brainstormed considerations; also captures the meeting notes afterwards."
---

# Client Meeting Prep and Capture

Deep briefing on a subject before a client meeting or call, and the capture step afterwards. Leads with the topic, not the people. Surfaces what's unresolved and brainstorms considerations, risks, and angles that may not have been raised yet.

## Usage

```
/om-meeting <topic>
```

Examples:
- `/om-meeting Acme homepage redesign`
- `/om-meeting Northwind launch checklist`
- `/om-meeting Acme` (a client: loads the client note and its projects)
- `/om-meeting capture Acme` (after the call: files the notes, see below)

## Workflow

1. **Search the vault** — run `qmd query "$ARGUMENTS"` and `qmd vsearch "$ARGUMENTS"` to find everything related to the topic, including semantically related content

2. **Load all related notes** — read every relevant result: work notes (`work/active/<project>/next.md` and `tasks.md` first), decisions, incidents, client and contact notes (`clients/`). A meeting about one topic often touches adjacent projects and prior decisions

3. **Build the subject picture** — synthesize what the vault knows:
   - Current status and recent changes
   - How this topic connects to other active work
   - Prior decisions that affect this topic
   - Outstanding items directly tied to this subject
   - Preferences and constraints from the client note: how they like to communicate, approve, and give feedback

4. **Surface open items** — collect all unresolved threads related to the topic:
   - Open checkboxes (`- [ ]`) from related notes
   - Documented blockers
   - Questions raised but not answered
   - Status fields with no recent movement

5. **Brainstorm considerations** — go beyond what's in the vault; think through:
   - What could go wrong that hasn't been written down yet
   - Dependencies on other teams, people, or systems not yet flagged
   - Decisions that will likely need to be made — and what the options are
   - Edge cases or failure modes worth raising
   - Things that have tripped up similar work before (check `brain/Gotchas.md`)
   - Scope, budget, or deadline pressure that the client may raise
   - Stakeholders who aren't in the room but whose work this affects

5b. **Carry-forward check** — open the client's last THREE meeting notes and compare their Action Items: any unchecked item appearing (same or near-same wording) in two or more consecutive notes is a chronic loop, not just an open one. List these separately with their first-seen date ("carried 3× since <date>"). Each one is either blocked (raise it), obsolete (kill it), or under-prioritized (say so).

5c. **Wins to share** — check `portfolio/Portfolio.md` and the current quarter's wins note for completed work or milestones since the last meeting with this client.

6. **Note relevant people** — list who's involved and their role relative to this topic only (relationship history lives on their `clients/contacts/` note)

7. **Present the briefing**:

   ### Current State
   Concise synthesis of where things stand on this topic right now.

   ### Open Items
   All unresolved tasks, blockers, and unanswered questions — checklist format.

   ### Likely Decisions
   What will probably need to be decided or agreed in this meeting, with options if known.

   ### Considerations Worth Raising
   Brainstormed angles, risks, dependencies, and edge cases — especially things NOT already in the vault. This is the most valuable section.

   ### Chronic Loops
   Items carried across 2+ consecutive client meetings (from step 5b), oldest first. Skip when there are none.

   ### Wins to Share
   Completed work and milestones worth mentioning, with enough context to explain the impact. Skip when there are none.

   ### People Involved
   Who's relevant to this topic and in what capacity (role only).

   ### Questions to Ask
   Suggested questions based on gaps, risks, or unresolved threads.

## After the Meeting: `/om-meeting capture <client>`

Take a transcript, raw notes, or an AI meeting summary the user pastes and file it.

1. **Parse the input** — handle transcripts, raw notes, or summaries.

2. **Create the meeting note** at `work/active/<project>/<Client> <YYYY-MM-DD>.md` when the meeting belongs to an active project, otherwise at `clients/<Client> <YYYY-MM-DD>.md` (never in the `work/meetings/` inbox; that is for raw exports) with:

   ```yaml
   ---
   date: "<meeting date>"
   quarter: QN-YYYY
   description: "<one-line summary of key topics discussed>"
   client: <client>
   tags:
     - work-note
   status: active
   ---
   ```

3. **Structure the note** with these sections:
   - **Key Takeaways** — bullet points of the most important things discussed, grouped by topic
   - **Decisions Made** — anything agreed upon (promote the significant ones to a decision record)
   - **Action Items** — with checkboxes, who owns each
   - **Quotes Worth Noting** — direct quotes that reveal priorities, feedback, or scope changes (use blockquotes)
   - **What Went Well** — what landed, what resonated
   - **What to Watch** — things to monitor, concerns, ambiguous signals
   - **Related** — wikilinks to the client note, contacts, and the project

4. **Update related notes**:
   - the client note in `clients/` (preferences, constraints, new facts, with an "as of" date)
   - the project's `work/active/<project>/next.md` and `tasks.md` when the meeting changed the plan
   - `brain/Memories.md` if any context changed

5. **Check for stale context** — if the meeting reveals something that contradicts existing vault notes, flag and update.

Preserve the conversational tone, separate what was SAID from what it MEANS (interpretation goes in "What to Watch"), and flag anything that should stay private.

For anything else — outcomes without a transcript, mixed context — use `/om-dump`; it routes everything to the right notes.

## Important

- **Lead with the subject, not the people** — this is a topic briefing, not a relationship prep
- The Considerations section is the core value — push beyond what's already documented
- If the topic has no vault notes, say so and offer to create a stub before the meeting
- Keep it scannable — the user needs to absorb this quickly before walking in
- Relationship context (who they are, how they work) belongs on the client and contact notes, not in the briefing
