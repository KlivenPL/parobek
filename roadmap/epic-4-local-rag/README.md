# Epic 4 — Local RAG / code index

**Phase:** NOW (with one piece deferred to Epic 6) · **Goal:** an on-disk embeddings
index of the repo so Claude can find the few relevant snippets via `local_codesearch`
instead of reading large swaths of files. Pure retrieval → **tier 1 (Safe)**.

**Key design decision (from review):** indexing is **automatic**, never a plain
command. The index builds and refreshes itself; the command only *inspects* or
*forces* it. Continuous file-watching belongs in the VS Code companion
([F6.4](../epic-6-vscode-companion/F6.4-filewatch-indexer.md)); NOW we use lazy +
opportunistic refresh, which one-shot scripts can do.

## Features

- [ ] [F4.1 — Provider embeddings](F4.1-provider-embeddings.md)
- [ ] [F4.2 — Auto-index](F4.2-auto-index.md)
- [ ] [F4.3 — `/local-index status|rebuild`](F4.3-local-index-command.md)
- [ ] [F4.4 — `local_codesearch` tool](F4.4-local-codesearch-tool.md)

## Sequencing & dependencies

```
F4.1 (embed())  ─>  F4.2 (auto-index)  ─>  F4.4 (local_codesearch)
                          ^
                          └──  F4.3 (status|rebuild command, inspect/force only)
```

- Needs [F3.1](../epic-3-mcp-toolbox/F3.1-mcp-server-skeleton.md) (the server hosts
  `local_codesearch`).
- This is the **largest** epic; sequence it after the commands/MCP basics land.

## Zero-dep constraint

Vectors are stored as JSON under `STATE_DIR` and cosine similarity is computed in
plain JS — no vector-DB dependency.
