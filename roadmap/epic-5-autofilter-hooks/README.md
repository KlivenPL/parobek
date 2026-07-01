# Epic 5 — Auto-filter hooks

**Phase:** NOW · **Goal:** automatic, tier-gated hooks that reduce what reaches
Anthropic. These are where the tier model "bites": tier 2 filters inputs, tier 3 starts
replacing reads. Every hook **self-gates** on `featureEnabled(config, …)` so it is
silent below its tier.

## Features

- [ ] [F5.1 — File-reference pre-digest](F5.1-file-reference-predigest.md) — tier 2
- [ ] [F5.2 — Big-read handling](F5.2-big-read-handling.md) — tier 2 nudge / tier 3 substitute
- [ ] [F5.3 — Auto pre-compact](F5.3-auto-pre-compact.md) — tier 3

## Sequencing & dependencies

- All depend on [F1.1](../epic-1-tiered-savings/F1.1-tier-config-foundation.md)
  (`featureEnabled`) and benefit from [Epic 3](../epic-3-mcp-toolbox/) tools existing.
- Build F5.1 first (cleanest), then F5.2/F5.3 (which lean on the deny-with-feedback
  and staging mechanics — read the feasibility notes carefully).

## Honest mechanism constraints (carried into each feature)

- A `UserPromptSubmit` hook only **ADDS** context — it cannot strip the user's own
  text. Saving comes from *avoiding a downstream large read*, not shrinking the prompt.
- A `PreToolUse` hook can only substitute output via **deny-with-feedback** (the model
  perceives a blocked call). That's a tier-3 behavior, clearly labeled.
- A hook **cannot run `/clear`**, so auto pre-compact only *stages* a summary.
- Hooks load at session start — restart Claude Code after editing `hooks.json`.
