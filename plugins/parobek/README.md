# parobek (plugin)

Use a local LLM (LM Studio) as a copilot for `/local-*` commands to reduce Anthropic
token usage. See the [repository README](../../README.md) for full docs and the
[CLAUDE.md](../../CLAUDE.md) for architecture.

## Contents

- **Commands** (`commands/`)
  - `/local-model` — select/inspect the local model used by `/local-*` commands;
    switch endpoint preset (`preset <name>`).
  - `/local-compact` — summarize the conversation locally (0 Anthropic tokens);
    run `/clear` afterward to load the compacted context.
  - `/local-config` — open the config in your editor; `status`/`reload` validates it;
    `reset` restores defaults (timestamped backup of the old file).
- **Hooks** (`hooks/hooks.json`)
  - `SessionStart` → `record-session.mjs` (persist transcript path) +
    `inject-summary.mjs` (inject the local summary after `/clear`).
  - `UserPromptSubmit` → `record-session.mjs` + `context-watch.mjs` (warn as the
    conversation nears the local context limit).
- **Scripts** (`scripts/`) — Node ESM, no dependencies. `lib/` holds shared modules;
  the compaction prompt is Parobek's own (an original local-compaction prompt).
  The local server is reached through a provider abstraction (`lib/provider.mjs` →
  `lib/providers/{openai,lmstudio,ollama}.mjs`).
- **Tests** (`scripts/__tests__/`) — zero-dependency `node:test` suite (no running
  local model needed). Run with `npm test` from this folder.

## Requirements

Node.js 18+ on `PATH`, and a running LM Studio (or OpenAI-compatible) local server.

## Notes

Hooks load at session start — restart Claude Code after editing `hooks.json` or any
hook script. Runtime state lives in `~/.claude/parobek/`.

## Roadmap

Planned features (a 3-tier savings model, more `/local-*` commands, an MCP toolbox,
local RAG, and a VS Code companion) are tracked in [`../../roadmap/`](../../roadmap/).
