---
description: Inspect or switch the Parobek savings tier (safe | balanced | max)
argument-hint: [status | safe | balanced | max]
allowed-tools: Bash(node:*)
disable-model-invocation: true
---

!`node ${CLAUDE_PLUGIN_ROOT}/scripts/local-tier.mjs "$ARGUMENTS"`

The output above is from Parobek. Relay it to the user as-is; do not take any
further action.
