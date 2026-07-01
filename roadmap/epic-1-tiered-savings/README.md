# Epic 1 — Tiered savings system

**Phase:** NOW · **Goal:** the configuration foundation that lets the user dial the
savings/quality trade-off, and that every other feature gates on.

Without this epic there is no "tier" to check, so it is the **first thing to build**.
It is pure config + one slash command + a shared warning helper — no quality risk of
its own.

See [../tiers.md](../tiers.md) for the tier model this epic implements.

## Features

- [x] [F1.1 — Tier config foundation](F1.1-tier-config-foundation.md)
- [x] [F1.2 — `/local-tier` command](F1.2-local-tier-command.md)
- [x] [F1.3 — Command-tier warnings](F1.3-command-tier-warnings.md)
- [ ] [F1.4 — Tier-guidance injection](F1.4-tier-guidance-injection.md)

## Sequencing & dependencies

```
F1.1 (config + helpers)
  ├─> F1.2 (/local-tier switcher)
  ├─> F1.3 (command warnings)        # used by every command in Epics 2 & 4
  └─> F1.4 (guidance injection)      # depends on MCP tools existing (Epic 3)
```

- **F1.1 is the hard prerequisite** for all of Epics 2–5 (each command/hook reads the
  tier via the F1.1 helpers).
- **F1.4** is most useful after Epic 3 ships tools to nudge toward, but can land
  earlier as a no-op until tools exist.
