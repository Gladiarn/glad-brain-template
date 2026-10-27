# Changelog

## v1.1.0 — 2026-10-27

### Added
- add a Gemini model chain for saves: `geminiFallbackModels` lists the models a save moves to, in order, when the current one is rate limited, overloaded, unreachable or answers 404, before Claude takes over
- add `graphAfterSave`, which starts the notes graph in the background after a Gemini save
- build `graph.html` and the report after `brain graph`, by running `graphify cluster-only` and `graphify export html` with no LLM after the extract
- record `modelsTried` in the save log

### Changed
- change the default model to `gemini-3.5-flash-lite`, with `gemini-3.1-flash-lite` and `gemini-3.8-flash` as fallbacks, because the free tier allows far more requests per day on the lite models
- stop starting the notes graph automatically after a save; set `graphAfterSave` to `true` to get it back

### Fixed
- document that a broken IPv6 route on WSL makes Gemini and npm requests hang or return empty 404s, and how to prefer IPv4; `setup.sh` suggests the fix when it detects the problem

## v1.0.0 — 2026-10-27

### Added
- add per-project plans, with the current project's plan for today injected at session start
- add the `save` and `save: <text>` triggers: Gemini writes the notes, checks its own output and fixes it, and a Claude Sonnet subagent saves instead when Gemini fails
- pull from git on session start, and commit and push on save and wrap-up
- add the `brain` CLI with `link`, `save`, `sync`, `graph`, `view` and `status`
- install the hooks globally through `bin/brain-hook`, so a linked repo needs no files of its own
- build graphify code graphs without an LLM, and a notes graph through Gemini
- add a secret guard that blocks commits containing API keys, including `AQ.` Gemini keys
- add a template guard that keeps personal notes out of the public template repo
- add `setup.sh` for WSL
- repurpose the vault for clients, portfolio and production incidents
- rename the Claude Code plugin to `glad-brain`

### Changed
- rewrite the README, CONTRIBUTING.md and the `/om-vault-upgrade` flow for Glad Brain, which now updates with `git pull template main`

### Removed
- remove ShardMind distribution: the install path is git clone plus `setup.sh`
- remove the obsidian-mind logo and demo GIF

Versions before 1.0.0 are obsidian-mind's history: https://github.com/breferrari/obsidian-mind/blob/main/CHANGELOG.md
