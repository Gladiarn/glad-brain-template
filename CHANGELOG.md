# Changelog

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
