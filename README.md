# 🥔 Parobek

![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)
![Node ≥18](https://img.shields.io/badge/node-%E2%89%A518-brightgreen)
![status: MVP](https://img.shields.io/badge/status-MVP-blue)
![Anthropic: unofficial](https://img.shields.io/badge/Anthropic-unofficial-lightgrey)

> *„Ano, najon się parobek do dworu. Chłop robotny, grosza darmo nie weźnie —
> od świtu młóci, rąbie i znosi, a jegomość niech ino o wielgich rzeczach duma."*
>
> — *Well now, a farmhand's taken on at the manor. A hard-working sort who won't
> take a coin for nothing — from first light he threshes, chops and hauls, so the
> master can keep his mind on the big things.*

**In plain terms:** **Parobek** is a [Claude Code](https://code.claude.com) plugin.
A **local LLM** (via [LM Studio](https://lmstudio.ai/) or any OpenAI-compatible
server) is the *parobek* — the hired hand that does cheap, mechanical work like
summarizing your conversation. Claude stays the *gospodarz* and does the real
thinking. The upshot: **fewer Anthropic tokens** for the boring parts.

The local model is used **only** by `/local-*` commands. Your normal prompts still
go to Anthropic, unchanged.

## Install

```text
/plugin marketplace add <owner>/parobek     # or a local path to this repo
/plugin install parobek@parobek
```

Then restart Claude Code (hooks load at session start) and pick a model:

```text
/local-model list
/local-model <model-id>
```

## Co parobek robi (what the hand does)

| Command | What it does |
|---------|--------------|
| `/local-model [id\|list\|status\|preset <name>]` | Select / inspect the local model used by `/local-*` commands. |
| `/local-compact [instructions\|status]` | Summarize the conversation with the **local** model (0 Anthropic tokens). Then run `/clear` to load the compacted context. |
| `/local-config [status\|reload\|reset]` | Open the config in your editor; `status`/`reload` re-reads and validates it and prints the effective config; `reset` restores defaults (timestamped `.bak` backup). |

### `/local-compact` flow

1. `/local-compact` — the parobek summarizes your conversation (with Parobek's own
   local-compaction prompt). **No Anthropic tokens are used.**
2. It prints `✅ … 0 Anthropic tokens` and `➡️ Run /clear …`.
3. You run **`/clear`** — a `SessionStart` hook injects the summary, so you continue
   with a compacted context.

Why two steps? Claude Code exposes no plugin API to replace a running session's
context in place; `/clear` + hook injection is the supported, safe path. Opening a
new window never triggers injection (guards: `source === 'clear'` + cwd + TTL +
single-consume + visible label).

## Jak to chodzi (how it works)

The *parobek* (local model) does the grunt work — summaries and digests — while the
*gospodarz* (Claude) keeps thinking about the big things. Anything the local model
produces is clearly labeled `[Parobek]` so you always know who did what, and normal
prompts never touch it.

## Requirements

- **Claude Code** with plugin support.
- **Node.js 18+** on your `PATH` (commands and hooks run Node scripts).
- A running **LM Studio** local server (default `http://localhost:1234/v1`) with a
  model loaded — or any OpenAI-compatible endpoint (an `ollama` preset is included).

## Configuration

Settings live in `~/.claude/parobek/config.json` (created on first use):

| Key | Default | Meaning |
|-----|---------|---------|
| `endpoint` | `http://localhost:1234/v1` | OpenAI-compatible base URL |
| `apiKey` | `lm-studio` | bearer token (LM Studio ignores the value) |
| `provider` | `lmstudio` | provider module handling this endpoint (`lmstudio`, `ollama`, or `openai`); selects native load-state detection and idle auto-unload. Set by `/local-model preset <name>` |
| `model` | `""` | selected local model id (set via `/local-model`) |
| `autoModelLoad` | `true` | when the model is not loaded: `true` lets the server JIT-load it; `false` errors instead |
| `autoUnloadMinutes` | `15` | idle minutes before the server unloads the model to free RAM (LM Studio `ttl`; Ollama `keep_alive`; `openai` ignores; `0` disables) |
| `temperature` | `0.2` | sampling temperature for summaries |
| `maxOutputTokens` | `2048` | max tokens for a summary (kept below `localContextTokens`) |
| `localContextTokens` | `8192` | local model context window (drives chunking + warnings) |
| `contextWarnFractions` | `[0.7, 0.9]` | warn at these fractions of the single-pass budget |
| `pendingTtlMs` | `900000` | how long a local summary stays valid for `/clear` |
| `presets` | _(code)_ | built-in endpoint presets (`lmstudio`, `ollama`) live in code and switch via `/local-model preset <name>`; not written to the file. Add your own `{ "presets": { "name": { "endpoint", "apiKey", "provider" } } }` for a custom endpoint and it is merged + preserved |

`/local-model <id>` auto-detects the context length from `/v1/models` when the
server exposes it; otherwise edit `localContextTokens` to match your model.

If you hand-edit `config.json` and leave invalid JSON, Parobek does not silently
revert to defaults — every `/local-*` command and hook reports
`[Parobek] Invalid plugin config: …` (naming the plugin and the file) and runs on
defaults until you fix it. Run `/local-config status` after editing to confirm the
file parsed. All on-screen output from this plugin is prefixed with `[Parobek]` so
it is attributable when you run many plugins.

## Large conversations

If a conversation is bigger than the local model's context, `/local-compact`
automatically switches to **map-reduce** (summarize chunks, then fold them into the
final summary) — still 0 Anthropic tokens. As the conversation grows, Parobek warns
you in Claude Code (at 70% and 90% of the local single-pass budget) so you can
compact while it is fast and free.

## Development

Scripts are plain Node ESM and run standalone:

```bash
node plugins/parobek/scripts/local-model.mjs status
node plugins/parobek/scripts/local-model.mjs list

# hooks read a JSON event on stdin:
echo '{"hook_event_name":"SessionStart","source":"startup","cwd":"'"$PWD"'"}' \
  | node plugins/parobek/scripts/inject-summary.mjs   # expect: no output
```

### Tests

An automated suite covers every module (config, state, tokens, transcript,
compaction prompt, the provider abstraction) plus the hooks and commands
end-to-end. It is **zero-dependency** (Node's built-in `node:test`), needs **no
running LM Studio/Ollama** (a local `node:http` mock server stands in), and is fully
isolated (`HOME` is redirected to a temp dir, so your real `~/.claude/parobek/` is
never touched):

```bash
cd plugins/parobek
npm test
```

See [CLAUDE.md](CLAUDE.md) for architecture and constraints.

## Roadmap

Planned work beyond this MVP lives in [`roadmap/`](roadmap/) — organized as **epics**
(folders) and **features** (`F*.md` files), with a master checklist in
[`roadmap/README.md`](roadmap/README.md).

Everything is governed by a **3-tier savings model** (see
[`roadmap/tiers.md`](roadmap/tiers.md)) that dials how aggressively quality is traded
for cost:

| Tier | The local model… | Quality |
|------|------------------|---------|
| **Safe** | **adds** a cheaper path; Anthropic still sees everything important | no risk |
| **Balanced** | **filters** inputs before Anthropic sees them | small risk |
| **Max** | **replaces** Anthropic's reasoning on whole subtasks | real trade-off |

Automatic behaviors (hooks, MCP routing) activate by tier; commands always run but
warn when they exceed your configured tier.

Epics (NOW = this Claude Code plugin · LATER = planned VS Code companion built on top):

- **Tiered savings system** (NOW) — the tier config + `/local-tier` switcher.
- **Local assist commands** (NOW) — `/local-commit`, `/local-ask`, `/local-handoff`.
- **MCP toolbox** (NOW) — a zero-dep MCP server with mechanical digest / extract /
  search tools (`local_summarize`, `local_read_digest`, `local_extract`, …).
- **Local RAG / code index** (NOW) — an auto-built embeddings index + `local_codesearch`.
- **Auto-filter hooks** (NOW) — pre-digest referenced files, pre-digest big reads,
  auto pre-compact.
- **VS Code companion** (LATER) — settings UI, status-bar savings meter,
  selection-digest, file-watch indexer, one-click compact + clear.

## Status

MVP. Known limitations are documented in [CLAUDE.md](CLAUDE.md).

## License & trademarks

Released under the [MIT License](LICENSE).

Parobek is an **independent, unofficial** project. It is **not affiliated with,
endorsed by, or sponsored by Anthropic**. "Claude", "Claude Code", and "Anthropic"
are trademarks of Anthropic, PBC, used here only nominatively to describe
interoperability.
