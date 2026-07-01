# Tier specification — Safe / Balanced / Max

The tier model is the backbone of the roadmap. It defines **how aggressively the
local model is allowed to stand in for Anthropic's reasoning**, and therefore how
much quality is traded for cost.

## The axis

The single question that places any feature in a tier:

> **What does the local model do to the information Anthropic reasons on?**

| Tier | Name | config key | level | The local model… | Quality risk |
|------|------|-----------|-------|-------------------|--------------|
| 1 | **Safe** | `safe` | 1 | **ADDS** a cheaper path. Anthropic still sees / can raw-read everything important; local output is reviewable and optional. | none |
| 2 | **Balanced** | `balanced` | 2 | **FILTERS** inputs before Anthropic sees them. Anthropic reasons on local digests, not the raw material. | small — local may drop a relevant detail |
| 3 | **Max** | `max` | 3 | **REPLACES** Anthropic's reasoning on whole subtasks (local answers, auto-substituted reads). | real — the brain is bypassed for those tasks |

"Full saving" = set the tier to `max`: maximum cost reduction, some quality loss.

## How a tier gates behavior

- **Automatic behaviors** (hooks, MCP routing nudges) activate **only when the
  configured level ≥ the feature's tier**. Each hook script reads the config and
  **self-gates** (no-op below its tier) — the same pattern
  [`context-watch.mjs`](../plugins/parobek/scripts/context-watch.mjs) already
  uses to read config and decide whether to emit.
- **Commands are never gated.** Every `/local-*` command always runs regardless of
  the configured tier. But each command carries an **associated tier**, and when that
  tier is **higher** than the configured one, the command prints a branded warning
  before doing its work:

  > `[Parobek] /local-ask runs at tier 3 (Max), above your configured tier 1 (Safe) — output quality may fall below what you set.`

  You can always reach for a stronger tool; you're just told when you exceed your own
  quality floor.

## Config mechanism — "presetted, but configurable"

Mirror the existing endpoint-`PRESETS` pattern in
[`config.mjs`](../plugins/parobek/scripts/lib/config.mjs) exactly:

- Add a code-owned `TIER_PRESETS` next to `PRESETS`, each entry
  `{ level, name, features: [...featureIds] }`.
- Add `savingTier: 'safe'` to `DEFAULT_CONFIG`.
- On read, merge built-ins with user-defined tiers from the file:
  `tiers: { ...TIER_PRESETS, ...(parsed.tiers ?? {}) }`.
- On write, **never persist the built-ins** (identical to how custom endpoint presets
  are kept but built-ins are stripped in `writeConfig`). A user can override a tier's
  feature set or add a custom tier, and it survives every write.
- New helpers:
  - `resolveTier(config) → { key, level, name }`
  - `featureEnabled(config, featureId) → boolean` (configured level ≥ feature tier)
  - `commandTierExceeds(config, cmdLevel) → boolean`
- Surface `savingTier` (+ resolved name/level) in `configSummaryLines`.

## Feature registry (tier per feature)

| Feature | Kind | Tier | Auto/Command |
|---------|------|------|--------------|
| `local_summarize`, `local_read_digest`, `local_extract`, `local_grep_digest`, `local_outline`, `local_log_triage`, `local_diff_digest` | MCP | 1 Safe | tool (model-invoked) |
| `local_codesearch` | MCP | 1 Safe | tool (model-invoked) |
| `/local-commit` | command | 1 Safe | always runs |
| `/local-index status\|rebuild` | command | 1 Safe | always runs |
| `/local-handoff` | command | 2 Balanced | always runs |
| File-reference pre-digest hook | hook | 2 Balanced | auto at level ≥ 2 |
| Big-read nudge | hook/guidance | 2 Balanced | auto at level ≥ 2 |
| Tier-guidance injection | hook | 2 Balanced | auto at level ≥ 2 |
| `/local-ask` | command | 3 Max | always runs |
| Big-read substitution (deny-with-feedback) | hook | 3 Max | auto at level ≥ 3 |
| Auto pre-compact (staging) | hook | 3 Max | auto at level ≥ 3 |

### Existing features
- `/local-model`, `/local-config` — **tier 0** infra (no quality effect; never warn).
- `/local-compact` — behaves like **Balanced** (Anthropic then reasons off a local
  summary), but stays always-available; its warning tier = `balanced`.
