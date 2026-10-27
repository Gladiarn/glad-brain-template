---
description: "Upgrade this vault to the latest Glad Brain template with git pull template main, or import another vault's content into this one."
---

# Vault Upgrade

Two jobs, picked by whether a source vault is given:

- **No source: upgrade THIS vault** to the latest Glad Brain template with `git pull template main`, keeping every local improvement. See *Upgrade this vault* below.
- **A source vault: import its content** into this vault. The source can be another Glad Brain vault or any Obsidian vault. See *Workflow* below.

## Usage

```
/om-vault-upgrade                                   # upgrade this vault (git pull template main)
/om-vault-upgrade --dry-run                         # show the upgrade plan only
/om-vault-upgrade <path-to-source-vault>            # import another vault's content
/om-vault-upgrade <path-to-source-vault> --dry-run
/om-vault-upgrade --source <path-to-source-vault> [--dry-run]
```

**Arguments**:
- `<path-to-source-vault>`: absolute or relative path to the vault to migrate FROM (positional or via `--source`)
- `--dry-run`: produce the plan without changing anything

## Upgrade this vault

A private brain is made from the public template and keeps it as the `template` git remote (README, "Updating"). Upgrading is `git pull template main`: git merges the template's changes into this vault. Notes are not at risk, because the template contains none. This command adds the judgment git does not give: before the pull, which files it will take as they are, which it will merge with your edits, which it will stop on, and which template files you changed that the template did not (a local improvement worth sending back).

**Never overwrite.** Do not run `git checkout --theirs`, `git reset --hard`, `git pull -X theirs`, `git merge -s ours` or any command that discards one side of a conflict. A conflicted file is shown to the user and resolved with them.

### U1. Plan

```bash
node --experimental-strip-types .claude/scripts/upgrade-plan.ts
```

It fetches `template` and prints what the pull would do. It never changes the vault: it asks git to merge in memory and reads the result.

- **No `template` remote:** it says so. Add it with `git remote add template https://github.com/Gladiarn/glad-brain-template.git`, then run it again.
- **No common history** (a vault made with GitHub's "Use this template" button): `git pull` cannot merge it. Use *Workflow* below, with a fresh clone of the template as the source.
- **Uncommitted changes:** it warns. Commit or stash first.

It prints every file needing judgment, sorted into:

| Section | Meaning | What happens |
|---|---|---|
| **Behind** | The template changed it; you did not | The pull takes the new version. Nothing of yours is lost |
| **Ahead** | A template file changed only in this vault | Kept. List it to the user as an **upstream candidate** if it is an improvement |
| **Merged** | Changed on both sides, merges cleanly | Show the user the result to review |
| **Conflicts** | Changed on both sides and git cannot merge it, or a new template file where you already have one | git stops; the user decides per file |
| **New in the template** | Added | Taken as is |
| **Move out** | A retired instruction file (`CLAUDE.md`, `GEMINI.md`) still in the vault | Claude Code reads a `CLAUDE.md` and skips `AGENTS.md`; Gemini no longer reads a `GEMINI.md`, so what the user added there is lost. With the user, move what they added: from `GEMINI.md` into `AGENTS.md`; from `CLAUDE.md` into `.claude/rules/local.md` (Claude Code only) or `AGENTS.md` (every agent; keep it under 23 KB, where the hygiene scan flags it: Antigravity stops reading at ~24,000 bytes), then delete it. Nothing is merged automatically |

Show the report to the user. With `--dry-run`, stop here.

### U2. Apply

1. Make sure the working tree is clean (`git status`). If it is not, ask the user to commit or stash.
2. Run `git pull template main`.
3. **No conflicts:** git finishes the merge. Go to U3.
4. **Conflicts:** git stops with the conflicted files marked. Show the user the list (`git diff --name-only --diff-filter=U`) and, for each file, both versions. The user decides each one. Resolve a file only as they say, then `git add <file>` and `git commit`. If they want to back out, `git merge --abort` returns the vault to where it was. Never pick a side for them.

A **Move out** file the user changed is not touched by the pull. Once the pull is done, move the additions as U1 says, then delete the file.

### U3. Verify

1. `git status` is clean and `git log -1` shows the merge or the fast-forward.
2. `vault-manifest.json` reports the new `version`.
3. The hooks run: `echo '{}' | node --experimental-strip-types .claude/scripts/session-start.ts` exits 0 and prints the session context, as one JSON object whose `hookSpecificOutput.additionalContext` carries it.
4. Run `cd .claude/scripts && npm test` if the vault has the tests.
5. Report the **ahead** files to the user as upstream candidates.

## Subagents

- **`vault-migrator`** — classifies files (for arbitrary vaults) and executes the approved migration plan

## Workflow

### 1. Validate & Detect

1. Parse the source vault path from the user's input. Resolve relative paths.
2. Verify the source path exists and is different from the current vault.
3. Verify the source path contains `.md` files (is it actually a vault?).
4. Check for `vault-manifest.json` in the source:
   - **Found**: read version directly. This is a Glad Brain vault, or one made from an earlier layout of the template.
   - **Not found**: run version fingerprint detection from the target's `vault-manifest.json`:
     - Check for `claude/Memories.md` without `brain/` → v1
     - Check for `brain/` + `bases/` without `.claude/agents/` → v2
     - Check for `.claude/agents/` → v3.x (refine by checking for specific files)
     - None match → **arbitrary vault** (not made from this template)
5. For arbitrary vaults, also detect the vault's **organizational pattern** (PARA, Zettelkasten, daily notes, flat, MOC-based, inbox). This shapes how the classifier interprets folder structure. Common patterns:
   - **PARA**: `Projects/` + `Areas/` + `Resources/` + `Archive/`
   - **Zettelkasten**: `Permanent/` + `Fleeting/` + `Literature/`, or many numeric-ID filenames
   - **Daily Notes**: `daily/` or `journal/` folder with date-named files
   - **Flat**: 80%+ of files in vault root
   - **MOC-based**: files named `MOC - *.md` or `Index - *.md`
6. Report detection result to the user: "Detected an earlier template layout (v2)" or "This looks like a PARA-organized Obsidian vault — I'll map Projects → work/active, Resources → reference, etc." or "This is a flat vault with no folder structure — I'll classify each note by its content."

### 2. Inventory & Classify

Read `vault-manifest.json` from the target (this vault) to know the infrastructure/scaffold/user_content classification rules.

**For Glad Brain and earlier-template source vaults:**

Glob all `.md`, `.base`, `.canvas` files and binary files (images, PDFs) in the source vault. For each file, classify deterministically:

| Source matches | Action | Target |
|----------------|--------|--------|
| `infrastructure` glob (but check exceptions below FIRST — MERGE takes precedence over SKIP) | **SKIP** | Template already has latest |
| `.gitignore` | **MERGE** | Keep template rules, append any user-added entries, log before/after diff |
| `bases/**` | **MERGE** | Keep template Bases, preserve user-added Bases, log conflicts for review |
| `.claude/commands/` not in template | **MERGE** | `.claude/commands/` (user addition) |
| `.claude/agents/` not in template | **MERGE** | `.claude/agents/` (user addition) |
| `.claude/scripts/` not in template | **MERGE** | `.claude/scripts/` (user addition) |
| `.claude/rules/` not in template | **MERGE** | `.claude/rules/` (user addition, such as `local.md` or a section moved out of `AGENTS.md`; its `AGENTS.md` pointer comes with the user's `AGENTS.md` additions) |
| `scaffold` path with real content | **REPLACE** | Same path in target |
| `scaffold` path with stub-only content | **SKIP** | Template stub is fine |
| `user_content_roots` glob | **COPY** | Same relative path |
| `.obsidian/` config files | **CONFIG** | `.obsidian/` (see config merge rules) |
| Binary files in user content roots | **COPY** | Same relative path |
| Everything else | **SKIP** | Log as skipped |

Detect scaffold "real content" by checking if the file has more than 5 lines of non-YAML, non-heading content beyond the template stub.

**For arbitrary vaults:**

1. Glob all `.md` files in the source vault (exclude `.obsidian/`, `node_modules/`, `.git/`, `.trash/`)
2. Also glob binary files (images: `*.png`, `*.jpg`, `*.svg`, `*.gif`; documents: `*.pdf`; other: `*.canvas`, `*.base`) — these are attachments that may be embedded in notes
3. Run Tier 0 (vault shape detection) to understand the organizational pattern
4. Attempt Tier 1 (structural) and Tier 2 (metadata — both YAML frontmatter and inline tags/Dataview fields) classification locally
5. For files that remain unclassified, launch the **vault-migrator** agent in **classification mode** — it reads content and applies Tier 3/4 heuristics. The agent classifies notes into work categories (work, client, contact, incident, meeting, decision, craft area, reference) but also recognizes non-work content (personal, learning, journal) and routes it to appropriate locations (`reference/personal/`, `reference/learning/`)
6. Incorporate the agent's classification map into the inventory
7. Notes with no YAML frontmatter will have frontmatter generated during execution (date, description, tags derived from content and inline signals)

**Idempotency check:**

If `brain/Migration Log.md` exists in the target vault, read it and extract the recorded hashes. Each log entry stores both a **source hash** (original file content) and a **final hash** (transformed content written to target).

On re-run, compute the **source hash** for each source file and compare against the logged source hash:
- Source hash matches for the same source path → **SKIP** (already migrated, unchanged)
- Entry exists but source hash differs → **FLAG** (source modified since last migration — ask user)
- No entry for this source path → process normally (new file)

### 3. Present Migration Plan

Build and present a structured plan to the user. This is the critical decision point — nothing executes without approval.

**Summary section:**
```
Source: ~/my-vault (template layout v2)
Target: this vault (Glad Brain v1.0.0)

Files found: 87
  COPY:     52 user content files
  REPLACE:   6 scaffold files with real content
  MERGE:     2 custom commands
  CONFIG:    4 .obsidian/ files
  SKIP:     18 infrastructure files (template has latest)
  CLASSIFY:  5 uncategorized → thinking/migrate-review/

Transformations:
  - 23 notes missing 'quarter' field (will derive from date)
  - 12 notes missing 'description' field (will generate)
  - 3 notes with alias field → normalize to 'ticket'
  - 1 v1 monolith Memories.md → split into topic files
```

**Detailed table** (show first 20, offer to show all):
```
| # | Source | Target | Action | Transforms |
|---|--------|--------|--------|------------|
| 1 | org/people/Jane.md | clients/contacts/Jane.md | COPY | +description |
| 2 | brain/Memories.md | brain/Memories.md | REPLACE | — |
| 3 | daily/2026-03-15.md | work/meetings/... | CLASSIFY+COPY | +quarter, +tags |
```

**Conflict section** (if any):
```
⚠ Conflicts requiring your input:
  - source has a CLAUDE.md (will NOT copy — its additions are listed for .claude/rules/local.md or AGENTS.md)
  - source has .claude/commands/my-custom.md (will MERGE as user addition)
```

Ask the user: "Does this plan look right? You can modify it — tell me to skip files, change targets, or adjust transformations. Say 'go' to execute."

**For `--dry-run`**: write the plan to `thinking/vault-upgrade-plan-YYYY-MM-DD.md` and stop.

### 4. Execute Migration

Once the user approves, launch the **vault-migrator** agent in **execution mode** with:
- Source vault path
- The approved migration plan
- The target vault's manifest

The agent handles all file operations: read from source, transform, write to target, rebuild indexes, copy .obsidian/ config, write migration log.

Wait for the agent to complete. If it reports errors, present them to the user.

### 5. Validate

After the agent completes:

1. Glob all newly created files in the target vault
2. Spot-check frontmatter on 5 random migrated files (read and verify required fields)
3. Check for broken wikilinks in migrated files (grep for `[[` patterns, verify targets exist)
4. Verify index files reference the migrated content
5. Count orphan notes (notes with zero inbound links)
6. Report results:

```
Migration complete.
  ✓ 52 files migrated
  ✓ 6 scaffold files replaced
  ✓ 2 custom commands merged
  ✓ Indexes rebuilt (work/Index.md, Clients, Portfolio, Memories)
  ✓ .obsidian/ config copied

  ⚠ 3 orphan notes (no inbound links) — run /om-vault-audit to fix
  ⚠ 5 files in thinking/migrate-review/ need manual sorting

  Migration log: brain/Migration Log.md
```

Offer next steps:
- "Run `/om-vault-audit` for a full structural check"
- "Review `thinking/migrate-review/` for uncategorized files"
- "Check `brain/Migration Log.md` for the full receipt and the source CLAUDE.md's additions to fold in"

## Important

- **The source vault is NEVER modified.** All operations are read-only on the source, write-only on the target.
- **Plan-first, always.** Never skip the plan presentation step, even if the migration looks simple.
- **Preserve user curation.** When rebuilding indexes, start from the source's version (which has the user's ordering and groupings), then append missing entries. Don't regenerate from scratch.
- **CLAUDE.md is user content, and never copied as CLAUDE.md.** A `CLAUDE.md` at the vault root makes Claude Code skip `AGENTS.md`, the template's one instruction file. If the source has one, diff it against the template's `AGENTS.md` and `.claude/rules/`, and log what it adds so the user can fold each addition into `.claude/rules/local.md` (Claude Code only) or `AGENTS.md` (every agent). Nothing is merged automatically.
- **Binary files matter.** Images, PDFs, and attachments embedded in notes must be copied or the embeds break.
- **Wikilinks resolve by filename.** Most folder moves don't break links. Only renames and full-path links need fixing.
- **Markdown links get converted.** Standard markdown links to local files (`[text](path.md)`) are converted to wikilinks (`[[name|text]]`). External URLs are left as-is.
- **Non-work content is welcome.** Not every note fits work, clients, or portfolio. Personal journal entries go to `reference/personal/`, book and course notes go to `reference/learning/`. The goal is zero data loss, not forcing everything into work categories.
- **No frontmatter is fine.** Many Obsidian vaults don't use YAML frontmatter. The migrator generates it from inline tags, Dataview fields, filenames, and content analysis.
- This command creates `thinking/migrate-review/` only if there are uncategorized files. Clean it up after manual sorting.
