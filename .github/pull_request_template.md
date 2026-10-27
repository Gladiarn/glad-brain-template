## Summary
<!-- What does this PR do? One or two sentences. -->

## Type
<!-- Your PR title must start with one of these prefixes. -->
<!-- e.g. "feat: add /om-review command" -->

- [ ] `feat` — new command, agent, hook, or capability
- [ ] `fix` — bug fix
- [ ] `docs` — documentation only
- [ ] `refactor` — code restructuring, no behavior change
- [ ] `test` — adding or updating tests
- [ ] `ci` — CI/CD workflow changes
- [ ] `chore` — maintenance, cleanup
- [ ] `build` — build system or packaging changes
- [ ] `perf` — performance improvements
- [ ] `style` — formatting, no behavior change
- [ ] `revert` — revert a previous change

## Checklist

- [ ] PR title follows `type: description` format
- [ ] No personal notes, plans or client names in the diff (the template guard fails the PR otherwise)
- [ ] A code change comes with a test that fails on `main` and passes with it
- [ ] Tests pass (`cd .claude/scripts && npm test`)
- [ ] Any NEW guard, check, or config constraint has demonstrated a red — broken deliberately, seen to fire, reverted. Say which, in one line
- [ ] Doc tables updated if adding commands/agents (AGENTS.md, README, Skills.md)
- [ ] No changes to CHANGELOG.md or the version in vault-manifest.json (set at release)
