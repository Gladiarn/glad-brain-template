# Glad Brain

[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
![Node 22+](https://img.shields.io/badge/node-22%2B-339933)
![Platform: WSL2](https://img.shields.io/badge/platform-WSL2-555555)

Persistent memory for Claude Code that works across many projects and stays in sync on every PC you use.

Glad Brain is an Obsidian vault with hooks and a small CLI. When you start Claude Code in a linked repo, that project's current plan is loaded. When you type `save`, the session's progress is written into the project's notes, checked, committed and pushed. Your other PCs pick it up the next time a session starts.

## Features

| Feature | Description |
|---|---|
| Per-project plans | Each project has a `next.md`, kept current by overwriting it rather than adding to it. It loads at session start in that project's repo, and other projects stay out of context. |
| Save trigger | `save` files the session, `save: <text>` files a single item, and `wrap up` runs a full review. Detection is done by a hook, so phrases like "add a save button" don't trigger it. |
| Checked saves | Gemini merges the session summary into the notes, reviews its own output, and corrects it. A script then checks the result. A save that fails a check writes nothing. |
| Claude fallback | If Gemini is unavailable, rate-limited or fails its check, a Claude Sonnet subagent performs the save and reports that it did. |
| Multi-PC sync | Sessions pull on start, and saves commit and push. Conflicts are reported, never overwritten. |
| Knowledge graph | graphify builds a free, code-only graph of each linked repo and a graph of your notes through Gemini. |
| Semantic search | QMD searches your notes by meaning, locally, with no API calls. |
| Clean client repos | `brain link` stores the link in the vault. Nothing is committed to the project repo. |
| Unsaved-session reminder | If a session ended without saving, the next one offers to save it. |
| Secret guard | A pre-commit hook blocks commits that contain API keys or tokens. |

## How it works

```
code repo                         private brain repo
---------                         ------------------
session start  -> git pull -> load work/active/<project>/next.md and tasks.md
"save"         -> Claude writes a summary
               -> brain save: Gemini writes, checks, fixes (max 2 rounds)
               -> script check -> write notes -> commit and push
               -> on any failure: Claude Sonnet saves instead
```

| Component | Role |
|---|---|
| Obsidian vault | Plans, tasks, decisions, lessons and client notes |
| graphify | Code structure, and relationships between projects |
| QMD | Search by meaning |
| Gemini (free tier) | Filing saves, so Claude usage goes to the work itself |
| git and GitHub | Keeping every PC on the same brain |

## Requirements

- **Windows with WSL2.** `setup.sh` checks for it. Native Windows and plain Linux are not supported yet.
- **Claude Code**
- **Node.js 22 or later, git, and uv.** uv installs graphify.
- **Obsidian for Windows.** Optional; it is used for browsing, and the brain works with it closed.
- **A Gemini API key** from [Google AI Studio](https://aistudio.google.com/apikey). Optional; without one, every save goes through Claude.

## Quick start

### 1. Create your private brain

Your notes never go into this public template. Create a private copy that keeps the template as a remote, so you can pull updates later:

```bash
git clone https://github.com/Gladiarn/glad-brain-template.git ~/brain
cd ~/brain
git remote rename origin template
rm .template-repo
git add -A && git commit -m "chore: create my private brain"
gh repo create my-brain --private --source . --remote origin --push
```

Deleting `.template-repo` turns off a CI check that only applies to the template. GitHub's "Use this template" button also works, but the copy it creates has no shared history, so `git pull template main` will not work later.

### 2. Run the setup

```bash
./setup.sh
```

Run this from a WSL terminal, not through a chat tool, so the key prompt works. The script:

- asks once for your Gemini key, without displaying it, and stores it in `~/.config/second-brain/.env` (mode 600, outside the repo)
- installs graphify and QMD
- registers the global Claude Code hooks and the `om` MCP server
- installs the secret guard

It is safe to run again. Options are `--no-qmd`, `--no-install` and `--non-interactive`.

Afterwards:

- Open a new terminal, so `brain` is on your PATH.
- Restart Claude Code. Sessions that started before setup do not have the hooks.
- To change the key later, run `./setup.sh --no-install` and paste the new key. Press Enter to keep the current one.

### 3. Link your projects

Run this once in each code repo:

```bash
cd ~/projects/client-site
brain link --client acme
```

graphify is installed once per PC by setup. `brain link` builds the graph for the repo you run it in. For notes that do not belong to any repo, start Claude Code in the vault folder, which uses the built-in `general` project.

### 4. Work as usual

```text
you    > what's the plan for today?
claude > (answers from client-site's next.md, which is already loaded)
...
you    > save
claude > Saved via Gemini: next.md, tasks.md, brain/Gotchas.md. Pushed.
```

### 5. Add another PC

On the new PC, clone your private brain, not the template, and run setup. The key is stored separately on each PC and never committed:

```bash
git clone git@github.com:<you>/my-brain.git ~/brain && cd ~/brain && ./setup.sh
```

## Commands

In Claude Code:

| Command | Action |
|---|---|
| `save` | Save the session's progress for the current project |
| `save: <text>` | Save one item |
| `wrap up` | Review the session, update the notes, then sync |
| `/om-standup` | Show today's plan, open tasks and priorities |
| `/om-dump` | Capture unstructured notes and sort them into the right places |
| `/om-meeting capture <client>` | Record a client meeting |
| `/om-incident-capture` | Document a production bug or outage |
| `/om-tidy` | Archive finished work and reorganize notes |

In the terminal:

| Command | Action |
|---|---|
| `brain link [--project <name>] [--client <name>]` | Link the current repo to a project |
| `brain status` | Show the current project, the model, and whether the key is set |
| `brain sync` | Pull, then commit and push |
| `brain graph` | Rebuild the code graph (no LLM) |
| `brain graph --notes [--yes]` | Rebuild the notes graph through Gemini. It shows the file count and waits for `--yes`. |
| `brain view` | Open the graph in a browser |

## Viewing the brain

- **Obsidian Graph view:** open the vault at `\\wsl.localhost\<distro>\home\<user>\brain`.
- **`brain view`:** graphify's interactive graph, in your browser.
- **Obsidian Canvas:** arrange notes by hand.

## Vault structure

```
work/active/<project>/   next.md, tasks.md, decisions, sessions
work/archive/YYYY/       finished projects
work/incidents/          production bugs and outages
clients/                 client notes and contacts
portfolio/               wins and case studies
brain/                   gotchas, patterns, key decisions, goals
templates/               note templates
graphify-out/            the knowledge graph, committed so other PCs need no rebuild
```

## Configuration

These settings live in `brain.config.json`:

| Key | Default | Purpose |
|---|---|---|
| `geminiModel` | `gemini-3.8-flash` | The Gemini model used for saves |
| `fallbackModel` | `sonnet` | The Claude model used when Gemini cannot save |
| `qmdEnabled` | `true` | Set to `false` to use plain text search on low-memory machines |
| `maxFixRounds` | `2` | The number of self-check rounds per save |
| `shrinkLimit` | `0.4` | A save is rejected if it shrinks an existing note by more than this share |

## Costs and privacy

- **Claude:** code graphs are built without an LLM. Saves use Gemini first, and Claude only as the fallback. graphify is never allowed to fall back to Claude.
- **Gemini free tier:** a save takes 2 to 4 requests. Once the daily limit is reached, saves fall back to Claude. On the free tier, Google may use the content you send to improve its products. Use a paid key or no key if that is a concern.
- **Your notes and key:** notes are stored in your private repository. The API key stays in `~/.config/second-brain/.env`.

Each save is logged to `.brain/save-log.jsonl` with the model used, token counts and outcome.

## Security

The hooks are dependency-free TypeScript in `.claude/scripts/`. `setup.sh` backs up `~/.claude/settings.json` before adding them, and they do nothing outside the vault and linked repos.

The Claude Code plugin in `.claude/skills/obsidian-mind/` runs unsandboxed. Review it before trusting the folder. `claude plugin validate .claude/skills/obsidian-mind` lists everything it hooks and calls. To disable it, add `"enabledPlugins": { "obsidian-mind@skills-dir": false }` to `.claude/settings.local.json`.

<!-- mod-validate:start -->
The two lines that matter in its output, for this version of the mod:

```text
  ❯ ./register.ts hooks: classic.SessionStart, prompt.context, classic.Stop, turn.complete, prompt.submit, turn.start
  ❯ ./register.ts calls: $.fs.write, $.process.run (via runScript), $.prompt.submit, $.session.root, $.state.get, $.state.set, $.store.get (via setShown, shownFor), $.store.set (via setShown), $.ui.invalidate
```
<!-- mod-validate:end -->

## Updating

```bash
git pull template main
```

This merges template changes into your brain. Your notes are not affected, because the template contains none.

## Troubleshooting

| Problem | Solution |
|---|---|
| The plan does not load in a repo | Run `brain status` in the repo. If it is not linked, run `brain link`. |
| "pull stopped by a conflict" | Two PCs edited the same note. Resolve the conflict in the vault with git, then run `brain sync`. |
| Saves always run through Claude | Run `brain status` to check the key, and check your quota at [AI Studio](https://aistudio.google.com/rate-limit). |
| WSL runs out of memory | Set `"qmdEnabled": false`, or raise `memory=` in `%UserProfile%\.wslconfig`. |

The full guide is in [docs/brain-setup.md](docs/brain-setup.md).

## About

Glad Brain is developed and maintained by [Gladiarn](https://github.com/Gladiarn).

It began as a fork of obsidian-mind. That foundation was built for a single job; Glad Brain reworks it for people who run many projects and clients across more than one PC. The main changes:

- Per-project plans that load automatically in each linked repo
- The `save` trigger, with a checked Gemini save and a Claude fallback
- Automatic git sync between PCs, including conflict handling
- `brain link`, global hooks, and client repos that stay clean
- graphify knowledge graphs alongside QMD search
- A secret guard, a template guard, and a one-command setup for WSL
- Client, portfolio and production-incident notes in place of the corporate review and Slack workflows

## License

MIT. Glad Brain includes code from obsidian-mind, obsidian-skills and obsidian-project-vault-template, all of which are MIT-licensed. Their notices are in [NOTICE.md](NOTICE.md).
