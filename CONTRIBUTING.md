# Contributing

Bug reports and issues are welcome from anyone. Open one on [Gladiarn/glad-brain-template](https://github.com/Gladiarn/glad-brain-template/issues) with what you ran, what you expected, and what happened. For a hook or CLI problem, include the output of `brain status`.

## Pull requests

1. Fork the repo and create a branch from `main`.
2. Make the change. A code change comes with a test that fails on `main` and passes with your change.
3. Run the tests from the repo root:

   ```bash
   cd .claude/scripts && npm test
   ```

4. Open a PR. The title follows the format below and the description says what changed and why.
5. When CI is green, I review it, then merge it, ask for changes, or close it with a reason.

For a larger change, such as a new hook, a new `brain` subcommand or a change to the vault structure, open an issue first so we can agree on the approach before you write the code.

## PR titles and commits

PR titles become commit messages when squash merged, so use the commit format:

```
type: short description
```

Write the description with an imperative verb: "add", "fix", "remove", not "added", "adds" or "fixing". The title should complete the sentence "If merged, this PR will ...".

| Type | Use for |
|---|---|
| `feat` | A new command, agent, hook or capability |
| `fix` | A bug fix |
| `refactor` | Restructuring with no behavior change |
| `docs` | Documentation only |
| `style` | Formatting only |
| `test` | Adding or updating tests |
| `chore` | Maintenance and cleanup |
| `perf` | Performance |
| `build` | Build or packaging |
| `ci` | CI workflow changes |
| `revert` | Reverting a previous change |

Good: `feat: add brain unlink command`, `fix: stop save crashing on an empty summary`.

Bad: `Update Skills.md` (no type), `fix bug` (no colon, no detail), `feat: added unlink` (past tense).

The `PR Title` workflow rejects a title that does not match.

## The template guard

This repo is the public template. It must never contain anyone's personal notes. The `Template Guard` workflow compares every pushed or proposed change against the globs in `.template-paths` and fails on any path outside them.

- Do not put your own notes, project plans, client names or session logs in a PR.
- A PR that adds real infrastructure (a new script, doc or config) adds its path to `.template-paths` in the same PR.
- A private brain made from this template deletes the `.template-repo` marker, which turns the guard off there.

## Keeping docs in sync

When you add or change a command, agent, hook or vault folder, update the places that describe it:

| File | What to update |
|---|---|
| `AGENTS.md` | The vault structure table. It has no command table and no counts. |
| `.claude/rules/subagents.md` | The agent table |
| `.claude/rules/hooks-per-agent.md`, `.claude/rules/hooks-and-mod.md` | The hook tables, when a hook or its event changes |
| `README.md` | Commands, vault structure |
| `brain/Skills.md` | The command tables and workflows |
| `bases/*.base` | If a note type or property is added |

A new, renamed or removed command also needs its Gemini wrapper regenerated:

```bash
node --experimental-strip-types .scripts/gemini-commands.ts
```

## New checks must fail once

A check that has never failed on a violation can look settled and prove nothing. For any new guard, hook validation, CI check or config constraint, break the thing it protects, confirm the check goes red, revert, and confirm it passes. Put one line in the PR saying what you broke and what fired.

## What the release handles

Do not edit these in a PR:

- `CHANGELOG.md`: I write the entry when I cut a release.
- The version in `vault-manifest.json` and in `.claude/skills/glad-brain/.claude-plugin/plugin.json`: they change together at release time.

## Maintainer notes

### Releasing

1. Write the new section at the top of `CHANGELOG.md`, under `# Changelog`, as `## vX.Y.Z — YYYY-MM-DD` with `### Added`, `### Changed` and `### Fixed` lists.
2. Set the same version in `vault-manifest.json` and `.claude/skills/glad-brain/.claude-plugin/plugin.json`. `cd .claude/scripts && npm test` fails if they disagree.
3. Commit, then push a tag named `vX.Y.Z`. The `Release` workflow creates the GitHub release from that section of `CHANGELOG.md`.

### Pulling obsidian-mind changes

Glad Brain began as a fork of [obsidian-mind](https://github.com/breferrari/obsidian-mind). The `upstream` remote points at it. To look at what it changed:

```bash
git fetch upstream
git log --oneline HEAD..upstream/main
git merge upstream/main    # or cherry-pick the commits you want
```

Expect conflicts. This repo has diverged: the plugin is renamed to `glad-brain`, the install path is `git clone` plus `setup.sh`, and many files are rewritten. Take upstream changes selectively, keep the credit lines in `LICENSE` and `NOTICE.md`, and run the tests before pushing.

### Checking what Claude Code delivers

The delivery gate runs real Claude Code sessions in throwaway vaults and checks that the session context arrives intact at startup, after `/compact`, after `/clear` and in a subagent. It needs a logged-in `claude`, costs model turns, and runs by hand. Run it before you pin a Claude Code version in the README or in `mod.yml`:

```bash
node --experimental-strip-types .github/scripts/delivery-gate.ts --trusted-dir <empty folder you opened once in Claude Code> --self-test
node --experimental-strip-types .github/scripts/delivery-gate.ts --trusted-dir <that folder>
```

The self-test must exit 0 first, which shows the gate can still fail. What counts as PASS, FAIL and INVALID is documented at the top of `.github/scripts/delivery-gate.ts`.
