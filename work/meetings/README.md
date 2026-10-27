---
date: 2026-04-07
description: "Inbox for raw meeting exports — drop notes here, then run /om-intake to classify and route to the right vault notes"
tags:
  - index
---

# Meeting Notes Inbox

Drop exported or raw client meeting and call notes here. Run `/om-intake` to process all files — it reads each one, classifies the content, and routes everything to the correct vault locations:

- Client meeting notes → the client's note in `clients/` and the relevant `work/active/` note
- Project updates → relevant `work/active/` note
- Decisions → Decision Record + `work/Index.md` decisions log
- Wins → `portfolio/Portfolio.md`
- Action items → relevant work notes

**This folder is a staging area, not storage.** Once a note is processed, `/om-intake` will ask to delete the raw export.

## Naming Convention

Drop files as-is from your export tool. Suggested prefix for clarity:

```
YYYY-MM-DD <Topic or Person>.md
```
