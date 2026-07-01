# CLAUDE.md — working on Parobek

Guidance for any Claude agent developing this repository.

## What this is

**Parobek** is a Claude Code plugin that offloads selected assistive tasks to a
**local LLM** (LM Studio or any OpenAI-compatible local server) to reduce Anthropic
token usage. The local model is a "copilot": it is used **only** by `/local-*`
commands, never for normal prompts (those still go to Anthropic).

Shipped in this MVP:
- `/local-model` — select/inspect the local model (and switch endpoint preset)
  used by `/local-*` commands.
- `/local-compact` — summarize the conversation with the local model (0 Anthropic
  tokens) and, via `/clear` + a `SessionStart` hook, replace the live context with
  that summary.
- `/local-config` — open the config in your editor; `status`/`reload` validates it;
  `reset` restores defaults (timestamped backup of the old file).

The local server is reached through a provider abstraction (`lib/provider.mjs`
dispatches on `config.provider` to `lib/providers/{openai,lmstudio,ollama}.mjs`):
`openai` is the vendor-neutral OpenAI-compatible base; `lmstudio` and `ollama` add
native load-state detection and idle auto-unload (`ttl` / `keep_alive`).

## Roadmap (living progress tracker)

Planned work beyond the MVP lives in [`roadmap/`](roadmap/), organized as **epics**
(folders) and **features** (`F*.md` files), governed by a 3-tier savings model
(Safe / Balanced / Max — see [`roadmap/tiers.md`](roadmap/tiers.md)). Start at
[`roadmap/README.md`](roadmap/README.md) for the overview, the NOW (Claude Code
plugin) vs LATER (planned VS Code companion) split, and the master checklist.

**Convention — keep status current.** When you implement a feature, tick its checkbox
in **two** places: the feature file's `Status` line **and** the matching entry in the
master checklist in `roadmap/README.md` (and the epic's own `README.md` checklist). The
roadmap is the single source of truth for what's done and what's next — update it as
part of the same change, not afterward.

## Hard architectural constraints (learned from the reference repos)

A third-party plugin can only register: markdown slash commands, agents/skills,
hooks, and MCP servers. It **cannot**:
- register a real model switcher (builtin `/model` is `type:'local-jsx'`), or
- replace the live in-memory context (builtin `/compact` is `type:'local'`).

Therefore:
- A slash command's `!`...`` stdout is sent to Anthropic *and* shown to the user,
  but only **after** the command finishes — there is no pre-completion text. The
  only token-free heavy lifting happens inside the Node scripts the command runs.
- Context replacement is achieved with: produce summary locally → user runs
  `/clear` → `SessionStart` hook (fires with `source:'clear'`, supports
  `additionalContext`) re-injects the summary.
- `/clear` regenerates the session id (old id kept only as an internal
  `parentSessionId`, NOT exposed to hooks), so we correlate the pending summary by
  **cwd**, gated by guards (see below).

## Repo layout

```
.claude-plugin/marketplace.json     # marketplace listing (source: ./plugins/parobek)
plugins/parobek/
  .claude-plugin/plugin.json
  commands/   local-model.md, local-compact.md, local-config.md   # thin wrappers
  hooks/      hooks.json                          # SessionStart + UserPromptSubmit
  scripts/
    lib/      config, state, tokens, transcript, compact-prompt, hookio, brand
    lib/providers/  openai.mjs (base), lmstudio.mjs, ollama.mjs  # provider modules
    lib/provider.mjs                                # getProvider() dispatch + facade
    local-model.mjs, local-compact.mjs, local-config.mjs   # command logic
    record-session.mjs, context-watch.mjs, inject-summary.mjs   # hook logic
refs/                                # local reference material (gitignored, not shipped)
```

Runtime state lives **outside** the repo in `~/.claude/parobek/`:
`config.json`, `session-<cwd-hash>.json`, `pending-summary-<cwd-hash>.json`,
`warn-<cwd-hash>.json`.

## Conventions

- **All code and comments in English.**
- Node.js **ESM** (`.mjs`), no third-party runtime dependencies (uses global
  `fetch`, Node 18+). Keep it dependency-free.
- `scripts/lib/` holds reusable modules; top-level scripts are entry points
  (commands run with an argument string; hooks read JSON from stdin).
- The compaction prompt in `scripts/lib/compact-prompt.mjs` is **Parobek's own**
  prompt: it instructs a local model to produce a structured `/local-compact`
  summary (an `<analysis>` block, then a `<summary>`). Keep its wording original —
  do not paste in prompt text from Claude Code or other tools.

## /local-compact: the 5 trigger safety guards

`inject-summary.mjs` injects ONLY when all hold (so opening a new window never
injects):
1. `hook_event_name === 'SessionStart'` AND `source === 'clear'`.
2. A pending summary exists for this cwd.
3. Freshness: within `pendingTtlMs` (else discard + notify).
4. Single-consume: pending file deleted on injection.
5. Clearly labeled `additionalContext` (never a silent change).

## Local context handling

Local models have smaller context windows. `local-compact.mjs`:
- single pass when the conversation fits `inputBudget(config)`;
- otherwise **map-reduce** (chunk → digest → fold → final 9-section summary) — so
  exceeding the local context is non-fatal, still 0 Anthropic tokens.

`context-watch.mjs` (UserPromptSubmit) warns in-CC (tiered 70%/90%, debounced) as
the conversation approaches the local single-pass budget.

**Degeneration hardening.** Small local models can fall into a repetition loop
(emit the same line thousands of times), wasting the run and — worse — poisoning
the next session if saved. Defenses: every chat request sends **hardcoded**
anti-repetition penalties (`frequency_penalty`/`presence_penalty`, plus
`repeat_penalty` for LM Studio/Ollama; two tiers in `providers/openai.mjs`
`ANTI_REPEAT`, not user-configurable); `lib/quality.mjs` `looksDegenerate()`
detects a looping/low-diversity response, so `callModel` retries **once** with the
`strong` tier + a higher temperature and, if it still loops, throws — refusing to
write the garbage as a pending summary. Context sizing is auto-detected, not
hand-tuned: `/local-model <id>` reads the model's real window via
`modelContextLength` (native `/api/v0/models` for LM Studio, `/api/show` for
Ollama) and sets `localContextTokens` + `maxOutputTokens`
(`deriveMaxOutputTokens`); `/local-compact` re-checks at preflight and clamps the
window **down** if the server now reports a smaller one (avoids chunk overflow,
the 400k+ trigger).

## Notifications

All feedback is **in Claude Code only** (no OS notifications). Surfaces: command
stdout, hook `systemMessage`, hook `additionalContext`. The "started" cue is
Claude Code's running-command spinner.

Every user-facing line carries the `[Parobek]` prefix (so it is attributable
when the user runs many plugins). Use `scripts/lib/brand.mjs`: `say(msg)` for
command stdout, `tag(msg)` for hook `systemMessage`/inline strings, `TAG` for the
`additionalContext` header. Brand the **header** line of a multi-line block;
indented detail lines stay plain `console.log` under that branded header.

## Testing

**Automated suite** (`plugins/parobek/scripts/__tests__/`, run with
`cd plugins/parobek && npm test`). Built on Node's `node:test` — no
third-party deps, no running local model. Design constraints worth keeping:

- **State isolation:** `STATE_DIR` is `join(homedir(), …)` resolved at import.
  Tests redirect `USERPROFILE`/`HOME` to a temp dir *before* importing
  `config.mjs`/`state.mjs` (`helpers/env.mjs` `redirectHome()` + a top-level
  `await import`), so the real `~/.claude/parobek/` is never touched.
- **Network:** a zero-dep `node:http` mock (`helpers/mock-server.mjs`) serves the
  OpenAI-compatible + LM Studio/Ollama native routes and logs requests; point
  `config.endpoint` at it instead of mocking `fetch`.
- **Two layers:** unit tests import `lib/` modules in-process; integration tests
  spawn the real entry/hook scripts (`helpers/run.mjs`) with the temp `HOME` and
  piped stdin. Commands key state by `process.cwd()`, so spawn them with a fixed
  `cwd` and create the session record (via `record-session.mjs`) under the same
  `cwd`. The editor-spawn path of `/local-config` is intentionally not tested.

Smoke test (quick manual sanity, still valid):
```
node plugins/parobek/scripts/local-model.mjs status
echo '{"hook_event_name":"SessionStart","source":"startup","cwd":"<cwd>"}' \
  | node plugins/parobek/scripts/inject-summary.mjs   # expect no output
```
End-to-end: install via `/plugin marketplace add <repo>` then
`/plugin install parobek@parobek`, restart Claude Code.

> Note: hooks load at session start — restart Claude Code after changing
> `hooks.json` or hook scripts.

## Reference material (in `refs/`, gitignored — never committed)

Local, uncommitted material used while developing (personal notes, public example
checkouts). For how Claude Code plugins, hooks, and slash commands behave, rely on
the official documentation at https://code.claude.com/docs — not on any bundled
source. Nothing under `refs/` ships in this repo.
