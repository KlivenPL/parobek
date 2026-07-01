---
description: Select the local LLM used by /local-* commands (LM Studio)
argument-hint: [model-id | list | status | preset <name>]
allowed-tools: Bash(node:*)
disable-model-invocation: true
---

!`node ${CLAUDE_PLUGIN_ROOT}/scripts/local-model.mjs "$ARGUMENTS"`

The output above is from Parobek. Relay it to the user as-is; do not take any
further action. The selected local model is used only by `/local-*` commands.
