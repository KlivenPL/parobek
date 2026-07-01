# Epic 6 — VS Code companion (future phase)

**Phase:** LATER · **Goal:** a VS Code extension **built on top of** the Claude Code
plugin that adds the affordances one-shot CC hook scripts can't provide — persistent
UI, daemons, editor-selection access, status bar, actionable notifications.

**Design principle:** the extension **reuses the same `lib/` modules** (`config`,
`provider`, `index`, `state`, digest prompts). Nothing in Epics 1–5 is throwaway; this
epic wraps that engine in a richer host. Build this only after the engine is solid.

## Why these are LATER (not NOW)

| Feature | Why it needs the extension |
|---------|----------------------------|
| Settings UI | CC config is a JSON file; a real UI needs a host (CLAUDE.md already marks the settings UI a VS Code concern) |
| Status bar savings meter | Needs a persistent UI surface |
| Selection context digest | CC hooks can't see the editor selection; the extension can |
| File-watch indexer | Needs a persistent daemon; CC hooks are one-shot |
| Tier switcher + notifications | Rich, interactive UI; a hook can't run `/clear` for the user |

## Features

- [ ] [F6.1 — Settings UI](F6.1-settings-ui.md)
- [ ] [F6.2 — Status bar savings meter](F6.2-status-bar-savings.md)
- [ ] [F6.3 — Selection context digest](F6.3-selection-context-digest.md)
- [ ] [F6.4 — File-watch indexer](F6.4-filewatch-indexer.md)
- [ ] [F6.5 — Tier switcher + notifications](F6.5-tier-switcher-and-notifications.md)

## Dependencies

Depends on the engine being in place: Epic 1 (config/tiers), Epic 3 (MCP/digest libs),
Epic 4 (index). This epic is sequenced **last**.
