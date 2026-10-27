---
description: "Freeform capture mode. Dump anything — conversations, decisions, incidents, wins, thoughts — and I'll route it all to the right notes with proper templates, frontmatter, and wikilinks."
---

Process the following freeform dump. For each distinct piece of information:

1. **Classify** it: decision, production bug or outage, client meeting content, win/achievement, architecture, project update, client or contact context, or general work note.
2. **Search first**: Use `qmd vsearch` (or `obsidian search`, or plain `grep -ril` across the vault when neither QMD nor the Obsidian CLI is available) to check if a related note already exists. Prefer appending to existing notes over creating new ones for small updates.
3. **Create or update** the appropriate note following AGENTS.md conventions:
   - Correct folder placement (work/active/<project>/, work/incidents/, work/meetings/, clients/, clients/contacts/, etc.)
   - Full YAML frontmatter with date, description, tags, and type-specific fields
   - All relevant [[wikilinks]] to clients, contacts, projects, craft areas
4. **Update indexes** as needed (work/Index.md, portfolio/Portfolio.md, clients/Clients.md)
5. **Cross-link**: Ensure every new note links to at least one existing note and is linked FROM at least one existing note.

After processing everything, provide a summary:
- What was captured and where each piece was filed
- Any new notes created (with paths)
- Any existing notes updated
- Any items you weren't sure how to classify (ask the user)

Content to process:
$ARGUMENTS
