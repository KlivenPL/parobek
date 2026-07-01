# Parobek — Roadmap

This folder is the **living progress tracker** for Parobek beyond the MVP. It
captures planned features as **epics** (big groupings) and **features** (one `F*.md`
file each). When a feature is implemented, tick its checkbox here **and** in its
feature file so status stays current.

## What this plans

A **menu of token-saving features** powered by the local LLM, governed by a **3-tier
savings model** that lets the user dial how aggressively quality is traded for cost.
See [tiers.md](tiers.md) for the full tier specification.

## The tier model (summary)

| Tier | Name | config key | Local model… | Quality risk |
|------|------|-----------|--------------|--------------|
| 1 | **Safe** | `safe` | **ADDS** a cheaper path; Anthropic still sees everything important | none |
| 2 | **Balanced** | `balanced` | **FILTERS** inputs before Anthropic sees them | small |
| 3 | **Max** | `max` | **REPLACES** Anthropic reasoning on whole subtasks | real |

- **Automatic behaviors** (hooks, MCP routing nudges) activate only when the
  configured level ≥ the feature's tier.
- **Commands are never gated** — they always run, but warn when their tier exceeds
  the configured one.

## NOW vs LATER legend

- **NOW** — implementable in the current Claude Code plugin (slash commands, hooks,
  MCP server, node scripts).
- **LATER** — belongs in the planned **VS Code companion** plugin (UI, persistent
  daemons, editor selection, status bar) that is built on top of this plugin and
  reuses the same `lib/` modules.

## Epics

| Epic | Phase | Goal |
|------|-------|------|
| [1 — Tiered savings system](epic-1-tiered-savings/) | NOW | The tier config foundation that gates everything else |
| [2 — Local assist commands](epic-2-assist-commands/) | NOW | `/local-commit`, `/local-ask`, `/local-handoff` |
| [3 — MCP toolbox](epic-3-mcp-toolbox/) | NOW | Zero-dep MCP server + mechanical digest/extract/search tools |
| [4 — Local RAG / code index](epic-4-local-rag/) | NOW | Auto-built embeddings index + `local_codesearch` |
| [5 — Auto-filter hooks](epic-5-autofilter-hooks/) | NOW | Pre-digest inputs, intercept big reads, auto pre-compact |
| [6 — VS Code companion](epic-6-vscode-companion/) | LATER | UI, status bar, file-watch indexer, notifications |

## Recommended build order

1. **Epic 1** (foundation — unblocks gating for everything else)
2. **F2.1 `/local-commit`** (cheapest, zero quality risk, high value)
3. **Epic 3** (MCP server skeleton + tier-1 tools)
4. **Epic 5 tier-2** (`F5.1`) + **F2.3 `/local-handoff`** + **F1.4** guidance
5. **Epic 5 tier-3** (`F5.2`, `F5.3`) + **F2.2 `/local-ask`**
6. **Epic 4** (local RAG)
7. **Epic 6** (VS Code companion — separate plugin, later phase)

## Master checklist

### Epic 1 — Tiered savings system (NOW)
- [x] F1.1 — Tier config foundation
- [x] F1.2 — `/local-tier` command
- [x] F1.3 — Command-tier warnings
- [x] F1.4 — Tier-guidance injection

### Epic 2 — Local assist commands (NOW)
- [x] F2.1 — `/local-commit`
- [ ] F2.2 — `/local-ask`
- [ ] F2.3 — `/local-handoff`

### Epic 3 — MCP toolbox (NOW)
- [x] F3.1 — MCP server skeleton
- [x] F3.2 — Digest tools

### Epic 4 — Local RAG / code index (NOW)
- [ ] F4.1 — Provider embeddings
- [ ] F4.2 — Auto-index
- [ ] F4.3 — `/local-index status|rebuild`
- [ ] F4.4 — `local_codesearch` tool

### Epic 5 — Auto-filter hooks (NOW)
- [ ] F5.1 — File-reference pre-digest
- [ ] F5.2 — Big-read handling
- [ ] F5.3 — Auto pre-compact

### Epic 6 — VS Code companion (LATER)
- [ ] F6.1 — Settings UI
- [ ] F6.2 — Status bar savings meter
- [ ] F6.3 — Selection context digest
- [ ] F6.4 — File-watch indexer
- [ ] F6.5 — Tier switcher + notifications
