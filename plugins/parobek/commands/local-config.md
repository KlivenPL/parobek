---
description: Open the Parobek config file in your editor (status/reload validates it, reset restores defaults)
argument-hint: [status | reload | reset]
allowed-tools: Bash(node:*)
disable-model-invocation: true
---

!`node ${CLAUDE_PLUGIN_ROOT}/scripts/local-config.mjs "$ARGUMENTS"`

The output above is from Parobek. Relay it to the user as-is; do not take any
further action.
