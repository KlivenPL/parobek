---
description: Draft a Conventional Commit message with a LOCAL model (0 Anthropic tokens) from the staged diff + conversation context
argument-hint: [focus | apply] [--short|--full] [--no-context]
allowed-tools: Bash(node:*)
disable-model-invocation: true
---

!`node ${CLAUDE_PLUGIN_ROOT}/scripts/local-commit.mjs "$ARGUMENTS"`

The output above is from Parobek — the commit message was drafted by the local
model with no Anthropic tokens used. Relay it to the user as-is and do not take any
further action. Nothing was committed unless the command was run with `apply`; if the
user wants to commit the draft, they run `/local-commit apply` themselves.
