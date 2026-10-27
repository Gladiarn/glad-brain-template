<h1 align="center">Glad Brain</h1>

<p align="center">
  <b>A second brain for Claude Code, synced across every PC you work on.</b><br>
  Obsidian vault for memory · graphify for connections · Gemini for filing · git for sync
</p>

<p align="center">
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-MIT-blue.svg" alt="MIT license"></a>
  <a href="https://docs.anthropic.com/en/docs/claude-code"><img src="https://img.shields.io/badge/claude%20code-hooks%20%2B%20commands-D97706" alt="Claude Code"></a>
  <a href="https://obsidian.md"><img src="https://img.shields.io/badge/obsidian-1.12%2B-7C3AED" alt="Obsidian"></a>
  <a href="https://github.com/Graphify-Labs/graphify"><img src="https://img.shields.io/badge/graphify-knowledge%20graph-0EA5E9" alt="graphify"></a>
  <a href="https://github.com/tobi/qmd"><img src="https://img.shields.io/badge/qmd-semantic%20search-FF6B6B" alt="QMD"></a>
  <a href="https://nodejs.org"><img src="https://img.shields.io/badge/node-22%2B-339933" alt="Node 22+"></a>
  <img src="https://img.shields.io/badge/platform-WSL2-555555" alt="WSL2">
</p>

---

Every Claude Code session starts with no memory of the last one. You end each session asking it to "update the notes so the next session remembers", and start the next one asking "what's the plan for today?".

Glad Brain does that for you, for every project:

- **Open any linked repo** and the project's plan for today is already in context.
- **Type `save`** and the session's progress is filed into the right notes, checked, committed and pushed.
- **Open the same brain on another PC** and it's up to date, because every session start pulls it.

It's built on [obsidian-mind](https://github.com/breferrari/obsidian-mind) and extends it for people who juggle many projects and clients. It was made with web developers and designers in mind, and works for any multi-project workflow.

## Features

| | |
|---|---|
| 🗓️ **Plan for today, per project** | Each project has a `next.md` that is updated in place. Starting a session in that project's repo loads it. Other projects stay out of the context. |
| 💾 **`save` trigger** | `save` files the session. `save: <text>` files one item. `wrap up` runs the full review. A hook detects the trigger, so it fires reliably in long sessions, and ordinary sentences like "add a save button" don't trigger it. |
| 🤖 **Gemini files, then checks itself** | Gemini merges the session summary into your notes, re-checks the result for lost, invented or misfiled content, and fixes it. A plain-script sanity check has the last word. A bad save writes nothing. |
| 🛟 **Claude fallback** | If Gemini is down, rate-limited or fails its check, a Claude **Sonnet** subagent does the save instead and tells you so. |
| 🔄 **Same brain on every PC** | Every session start runs `git pull`, and every save commits and pushes. A conflict never overwrites anything: you see the conflicting files and resolve them yourself. |
| 🕸️ **graphify knowledge graph** | A free code-only graph in every linked repo, plus a notes graph through Gemini. Claude can query how things connect instead of reading file after file. |
| 🔍 **QMD semantic search** | Local search by meaning. It finds "Stripe webhook failed" when you ask about "payment bugs". No API calls. |
| 🔗 **`brain link`, one step per repo** | Run it once per repo. Nothing is written into the repo itself, so client repos never show a trace of your brain. |
| 🔔 **Unsaved-session reminder** | Forgot to save? The next session start offers to save it. It never saves without asking. |
| 🔐 **Secret guard** | A pre-commit hook blocks any brain commit that contains an API key or token. |
| 👥 **Clients and portfolio** | Client notes, contacts, client meetings, production incidents, wins and case studies, all linked. |

## How it works

```
 your code repo                      your private brain (this template + your notes)
 ──────────────                      ──────────────────────────────────────────────
 claude  ──SessionStart──▶  git pull ─▶ load work/active/<project>/next.md + tasks
         ──"save"────────▶  Claude writes a short summary
                            └▶ brain save ─▶ Gemini: write → self-check → fix (≤2)
                                           ─▶ sanity check ─▶ write notes
                                           ─▶ git commit + push ─▶ other PCs pull it
                                 (Gemini down / failed ─▶ Claude Sonnet saves instead)
```

| Piece | Job |
|---|---|
| **Obsidian vault** | *What was decided*: plans, tasks, decisions, lessons, clients |
| **graphify** | *How things connect*: code structure, and relationships across projects |
| **QMD** | *Where you wrote about it*: search by meaning |
| **Gemini** (free tier) | Files saves cheaply, so your Claude usage goes into the work itself |
| **git + GitHub** | Keeps every PC on the same brain |

## Requirements

- **Windows with WSL2.** `setup.sh` checks for it; native Windows and plain Linux aren't supported yet.
- **[Claude Code](https://docs.anthropic.com/en/docs/claude-code)**
- **Node.js 22+**, **git**, and **[uv](https://docs.astral.sh/uv/)** (used to install graphify)
- **[Obsidian](https://obsidian.md)**, the Windows app, for browsing and editing. It's optional, and the brain works with Obsidian closed.
- **A Gemini API key** from [Google AI Studio](https://aistudio.google.com/apikey). It's optional: without one, every save goes through Claude.

## Quick start

### 1. Create your private brain

Your notes never go into this public template. Create a private copy that keeps the template as a remote, so you can pull improvements later:

```bash
git clone https://github.com/Gladiarn/glad-brain-template.git ~/brain
cd ~/brain
git remote rename origin template
rm .template-repo                       # turns off the template-only CI guard
git add -A && git commit -m "chore: create my private brain"

gh repo create my-brain --private --source . --remote origin --push
```

> **"Use this template" on GitHub works too**, but it creates a copy with no shared history, so `git pull template main` won't work later. Cloning, as above, keeps you on the update path.

### 2. Run the setup

```bash
./setup.sh
```

It asks once for your Gemini key, without echoing it, and stores it in `~/.config/second-brain/.env` (mode 600, outside the repo). It then installs graphify and QMD, registers the global Claude Code hooks and the `om` MCP server, and installs the secret guard. Re-running it is safe. Options: `--no-qmd`, `--no-install`, `--non-interactive`.

Run it from a **WSL terminal**, not through a chat tool, so the hidden key prompt works. Then:

- **Open a new terminal**, so `brain` is on your PATH.
- **Restart Claude Code.** Sessions that started before setup don't have the hooks.
- **To change the key later**, run `./setup.sh --no-install` again and paste the new one. Press Enter instead to keep the current key.

### 3. Link your projects

In each code repo, once:

```bash
cd ~/projects/client-site
brain link --client acme
```

This is once per repo. graphify itself is installed once per PC, by setup. For notes that don't belong to any repo, start Claude Code in the vault folder itself, which uses the built-in `general` project.

### 4. Work as usual

```text
you    ›  what's the plan for today?
claude ›  (answers from client-site's next.md, already loaded)
 …work…
you    ›  save
claude ›  saved via Gemini: next.md, tasks.md, brain/Gotchas.md. Pushed.
```

### 5. Add another PC

Clone your **private brain**, not the template, then run the setup. The key is stored per PC and never committed:

```bash
git clone git@github.com:<you>/my-brain.git ~/brain && cd ~/brain && ./setup.sh
```

## Everyday commands

| In Claude Code | Does |
|---|---|
| `save` | Save this session's progress for the current project |
| `save: <text>` | Save one item, for example `save: use Stripe Checkout, not Elements` |
| `wrap up` | Full end-of-session review, then sync |
| `/om-standup` | Morning kickoff: plan, open tasks, priorities |
| `/om-dump` | Dump anything; it gets routed to the right notes |
| `/om-meeting capture <client>` | Capture a client call |
| `/om-incident-capture` | Write up a production bug or outage |
| `/om-tidy` | Archive finished work, group related notes, split oversized ones |

| In the terminal | Does |
|---|---|
| `brain link [--project <name>] [--client <name>]` | Wire the current repo to a brain project |
| `brain sync` | Pull, then commit and push |
| `brain graph` | Rebuild the code graph (free, no LLM) |
| `brain graph --notes [--yes]` | Rebuild the notes graph through Gemini. It shows the file count first. |
| `brain view` | Open the knowledge graph in your browser |
| `brain status` | Show the current project, model and key status |

## Viewing your brain

- **Obsidian Graph view:** every note is a node and every link is an edge. Open the vault at `\\wsl.localhost\<distro>\home\<user>\brain`.
- **`brain view`:** graphify's interactive concept map in your browser.
- **Canvas:** lay notes out by hand, like a whiteboard.
- **Optional plugins:** *graphify-visualizer* and *3D Graph*.

## Vault structure

```
work/active/<project>/   next.md (plan for today) · tasks.md · decisions · sessions
work/archive/YYYY/       finished projects (searchable, out of the startup context)
work/incidents/          production bugs and outages
clients/                 one note per client · contacts/
portfolio/               wins · case studies · craft areas
brain/                   Gotchas · Patterns · Key Decisions · North Star
templates/               note templates
graphify-out/            graph.json + report (committed, so other PCs need no rebuild)
```

## Configuration

`brain.config.json`:

| Key | Default | |
|---|---|---|
| `geminiModel` | `gemini-3.8-flash` | Any Gemini model ID; the default is the best on the free tier |
| `fallbackModel` | `sonnet` | The Claude model used when Gemini can't save |
| `qmdEnabled` | `true` | `false` falls back to plain text search, for low-memory machines |
| `maxFixRounds` | `2` | How many self-check rounds a save gets |
| `shrinkLimit` | `0.4` | Reject a save that shrinks an existing note by more than this share |

## Costs and privacy

- **Claude usage:** code graphs are built locally with no LLM, and saves go to Gemini first. Claude is used only as the save fallback, at about one Sonnet subagent call per save. graphify is never allowed to fall back to Claude.
- **Gemini free tier:** a save takes 2–4 requests. When you hit the daily limit, saves fall back to Claude instead of failing. Google may use free-tier content to improve its products. If your notes are sensitive, use a paid key, which isn't used that way, or no key at all.
- **Your notes** live in *your* private GitHub repo. The API key never leaves `~/.config/second-brain/.env`.

Every save is logged to `.brain/save-log.jsonl` with the model, token counts and outcome, so you can see what it actually costs.

## Security: what runs on your machine

- **Hooks:** plain TypeScript in `.claude/scripts/` with zero dependencies, run by Node. `setup.sh` backs up `~/.claude/settings.json` before merging them in. Outside the vault and linked repos they do nothing.
- **The Claude Code mod:** `.claude/skills/obsidian-mind/`, from obsidian-mind. It's unsandboxed plugin code, so check it before trusting the folder. `claude plugin validate .claude/skills/obsidian-mind` lists everything it hooks and calls. To turn it off, add `"enabledPlugins": { "obsidian-mind@skills-dir": false }` to `.claude/settings.local.json`.

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

Template improvements merge into your brain. Your notes are never touched, because the template doesn't contain any, and a CI guard keeps it that way.

## Troubleshooting

| Symptom | Fix |
|---|---|
| Plan doesn't load in a repo | Run `brain status` in the repo. If it says unlinked, run `brain link`. |
| "pull stopped by a conflict" | Both PCs edited the same note. Resolve it in the vault with git, then run `brain sync`. |
| Saves always say "via Claude" | Run `brain status` to check the key, and check your quota at [AI Studio](https://aistudio.google.com/rate-limit). |
| WSL runs out of memory | Set `"qmdEnabled": false`, or raise `memory=` in `%UserProfile%\.wslconfig`. |

More detail is in [docs/brain-setup.md](docs/brain-setup.md).

## Credits

Glad Brain stands on excellent open-source work:

- **[obsidian-mind](https://github.com/breferrari/obsidian-mind)** by Brenno Ferrari (MIT): the vault, hooks, commands, MCP server and QMD integration this is built on
- **[obsidian-project-vault-template](https://github.com/BrineWR71/obsidian-project-vault-template)** (MIT): the project, session, decision and next-session templates
- **[graphify](https://github.com/Graphify-Labs/graphify)** (Apache-2.0): the knowledge graph
- **[claude-code-memory-setup](https://github.com/lucasrosati/claude-code-memory-setup)** (MIT): the "Obsidian for decisions, graphify for structure" split
- **[obsidian-skills](https://github.com/kepano/obsidian-skills)** by Steph Ango, and **[QMD](https://github.com/tobi/qmd)** by Tobi Lütke

See [NOTICE.md](NOTICE.md) for the full licence notices.

## License

[MIT](LICENSE)
