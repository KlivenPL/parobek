# Epic 3 — MCP toolbox

**Phase:** NOW · **Goal:** expose the local model to Anthropic as a set of **purely
mechanical** MCP tools (compression, retrieval, extraction). Anthropic chooses when to
call them and can always fall back to a raw `Read`, so they are all **tier 1 (Safe)**:
they only ever offer a cheaper path.

The tier never changes *whether* the tools exist — it changes how strongly Anthropic
is nudged to use them (see [F1.4](../epic-1-tiered-savings/F1.4-tier-guidance-injection.md)).

## Features

- [x] [F3.1 — MCP server skeleton](F3.1-mcp-server-skeleton.md)
- [x] [F3.2 — Digest tools](F3.2-digest-tools.md)

## Sequencing & dependencies

```
F3.1 (server skeleton)  ─>  F3.2 (tools)  ─>  F4.4 local_codesearch (Epic 4)
```

- **F3.1 first** — the JSON-RPC transport + tool dispatch.
- **F3.2** adds the digest/extract/search tools on top.
- `local_codesearch` ([F4.4](../epic-4-local-rag/F4.4-local-codesearch-tool.md)) is a
  tool of this server but lives in Epic 4 because it needs the index.

## Key constraint

**Zero runtime dependencies** (repo rule). The server is a hand-rolled minimal
JSON-RPC stdio implementation — no `@modelcontextprotocol/sdk`.
