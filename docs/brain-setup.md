# Brain setup

How to set up and use the second brain on a PC. The README has the three flows (make your own brain, second PC, template updates); this page covers what the setup does and what you do after it.

## What setup.sh does

Run `./setup.sh` from the vault. It is safe to run again, and it targets WSL2 on Windows. Options are `--non-interactive` (read the key from stdin), `--no-qmd` (skip semantic search) and `--no-install` (download nothing).

- Checks that this is WSL and that Node is 22 or newer.
- Installs graphify with `uv tool install 'graphifyy[gemini]'` and runs `graphify install`, and installs QMD unless you pass `--no-qmd`. The `qmdEnabled` switch in `brain.config.json` is set to match, so search falls back to grep when QMD is off.
- Asks once for your Gemini API key and stores it in `~/.config/second-brain/.env` with mode 600. The same file records where the vault is and puts `bin/` on your PATH. The key is never written inside the repo and the script never prints it.
- Adds one `# second-brain` line to `~/.zshrc` and `~/.bashrc` that loads the env file.
- Merges the brain's hooks into `~/.claude/settings.json` for SessionStart, UserPromptSubmit, PostToolUse, PreCompact and Stop, after backing the file up to `settings.json.bak-<timestamp>`. Your own hooks stay where they are.
- Registers the `om` MCP server at user scope, and writes a marked `<!-- second-brain -->` section into `~/.claude/CLAUDE.md` that tells Claude the vault exists and when to use it.
- Installs `bin/brain-precommit` as the vault's `.git/hooks/pre-commit`. It blocks any commit that contains an API key or token, using gitleaks when it is installed and a built-in scan when it is not.
- Prints the Windows path to open in Obsidian, and a note about WSL memory.

## Opening the vault in Obsidian

Obsidian runs on Windows and opens the vault from WSL at `\\wsl.localhost\<distro>\home\<user>\brain`. The Obsidian CLI may not be reachable from WSL, so every command that uses it falls back to reading the files directly.

QMD loads local search models of about 2.3 GB. If WSL runs out of memory, raise `memory=` under `[wsl2]` in `%UserProfile%\.wslconfig` (for example `memory=8GB`) and run `wsl --shutdown` from Windows, or set `"qmdEnabled": false` in `brain.config.json`.

## Linking a code repo

Run `brain link` in the repo, once. It adds one entry to `projects.map.json` in the vault, keyed by the repo's git remote so the same entry works on both PCs whatever the local path (a repo with no remote is keyed by its path on that PC only). It creates `work/active/<project>/next.md` and `tasks.md` and one line in `work/Index.md`, and runs the free code-only graphify build. Use `--project <name>` and `--client <name>` to choose the names. Nothing is written into the repo.

The new plan starts empty, and `brain link` does not read the codebase. Each session in the repo starts with the plan and a short summary of the code graph: the size of the codebase, its hub files, and a pointer to `graphify query "<question>" --graph graphify-out/graph.json`, which Claude uses before opening files. While the plan is empty, the session offers once to fill it from `graphify-out/GRAPH_REPORT.md` and `git log --oneline -30` and then save it. That costs about 15–20k tokens, once, and nothing happens unless you say yes.

If the graph report was built from an older commit than HEAD, the session starts `graphify update` in the background. It runs code-only with no LLM, and at most once every 10 minutes.

## Saving

- Say `save` and Claude writes a short summary of the session. `brain save` has Gemini merge it into the vault notes, check its own work, and pass a plain-script sanity check. Only the current project's folder, its line in the work index, the brain lessons and the linked client note can change.
- Say `save: <text>` to file one item. Say `wrap up` for the full end-of-session review.
- A save tries `geminiModel` first (default `gemini-3.5-flash-lite`). If that model is rate limited, overloaded, unreachable or answers 404, the save moves to the next model in `geminiFallbackModels` for its remaining calls and retries the failed call. A rejected request (400, 401, 403), a failed self-check or a failed sanity check goes straight to Claude without trying another model.
- The notes graph is not started after a save. Set `"graphAfterSave": true` in `brain.config.json` to start it in the background, or run `brain graph --notes --yes` when you want it.
- If every Gemini model is unavailable, there is no key, or the result fails its check, nothing is written and Claude files the same summary through a Sonnet subagent, then runs `brain save --commit-only`. It tells you which way it went.
- Every save is committed and pushed. Two sessions saving at once wait on a lock for up to 30 seconds, then report `save busy`. Every save is logged in `.brain/save-log.jsonl` with the model that produced the saved result, every model tried (`modelsTried`), token counts and outcome.
- A session that started after the last save and never saved is mentioned at the next session start, with an offer to record it.
- A save records the code repo's commit in `.brain/last-save/<project>`. If HEAD has moved past it, the next session is told how many commits the plan is behind and to run `git log --oneline <commit>..HEAD` before trusting it.

## Two PCs

Every session start pulls the brain. If the remote cannot be reached, or both PCs changed the same note, the session starts anyway with a warning, and nothing is overwritten. `brain sync` pulls and pushes by hand. A push that failed is retried by the next save.

## Template updates and the template guard

The brain is a clone of the template with the template as a git remote, so `git pull template main` brings improvements in. The template repo itself carries a `.template-repo` marker; while it exists, a CI check fails any change outside the paths in `.template-paths`, which keeps notes out of the public repo. You delete the marker in your private copy.

## Commands

| Command | Does |
|---|---|
| `brain link` | wire the current repo to a vault project |
| `brain save --summary <file>` | file a session summary (Claude runs this for you) |
| `brain save --commit-only` | commit and push after a save Claude filed by hand |
| `brain sync` | pull, then commit and push |
| `brain graph` | rebuild the code graph, free |
| `brain graph --notes` | show how many changed notes would go to Gemini; add `--yes` to send them |
| `brain view` | open the graph in your Windows browser |
| `brain status` | show the current project, model and whether a key is set |

## Viewing your brain

There are four ways to look at what the brain knows, from the simplest to the most visual.

- **Obsidian Graph view.** Open the vault in Obsidian and press the graph icon. It draws the links between your notes and needs no setup.
- **Canvas.** Create a `.canvas` file to lay notes out by hand, for example a project's plan next to its client note.
- **`brain view`.** After `brain graph` has built the graph, `brain view` opens `graphify-out/graph.html` in your Windows browser. It tries `wslview`, then `explorer.exe`, then `xdg-open`. If there is no graph yet it tells you to run `brain graph` first.
- **Community plugins (optional).** The graphify-visualizer and 3D Graph plugins show the graphify graph inside Obsidian. Install them from Settings, Community plugins if you want them.

`brain graph` builds the code graph for free. `brain graph --notes` shows how many changed notes it would send to Gemini and waits for `--yes`. It never falls back to Claude: with no `GEMINI_API_KEY` it refuses.

## Gemini or npm requests hang or return empty 404s on WSL

WSL's IPv6 route can be broken, so a request that picks an IPv6 address hangs or fails. Prefer IPv4:

```
echo 'precedence ::ffff:0:0/96  100' | sudo tee -a /etc/gai.conf
```

`setup.sh` prints this suggestion when `getent ahosts generativelanguage.googleapis.com` lists an IPv6 address first.
