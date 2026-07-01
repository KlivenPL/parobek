# Epic 2 — Local assist commands

**Phase:** NOW · **Goal:** user-invoked commands that do real work locally at 0
Anthropic tokens, spanning all three tiers so they double as the clearest
demonstration of the tier model.

Each command is a thin `.md` wrapper over a node script, following the existing
`/local-compact` shape, and calls `warnIfTierExceeds` (F1.3) early.

## Features

- [x] [F2.1 — `/local-commit`](F2.1-local-commit.md) — tier 1 (Safe)
- [ ] [F2.2 — `/local-ask`](F2.2-local-ask.md) — tier 3 (Max)
- [ ] [F2.3 — `/local-handoff`](F2.3-local-handoff.md) — tier 2 (Balanced)

## Sequencing & dependencies

- All depend on [F1.1](../epic-1-tiered-savings/F1.1-tier-config-foundation.md) +
  [F1.3](../epic-1-tiered-savings/F1.3-command-tier-warnings.md).
- **F2.1** is the recommended first command after Epic 1 (cheap, zero risk).
- **F2.3** reuses the pending-summary + `inject-summary` machinery from
  `/local-compact`, so build it once that flow is well understood.
