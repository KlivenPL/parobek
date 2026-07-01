---
description: Compact context with a LOCAL model (0 Anthropic tokens); then run /clear to apply
argument-hint: [instructions | status]
allowed-tools: Bash(node:*)
disable-model-invocation: true
---

!`node ${CLAUDE_PLUGIN_ROOT}/scripts/local-compact.mjs "$ARGUMENTS"`

The output above is from Parobek — the summary was produced by the local model
with no Anthropic tokens used. Relay the output to the user as-is and do not take
any further action. If it says to run `/clear`, the user must do that themselves to
load the compacted context.
