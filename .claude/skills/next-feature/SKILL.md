---
name: next-feature
description: >-
  Drive the Parobek roadmap forward one feature at a time: pick the next
  unbuilt feature, discuss it with the user in plan mode, write an implementation
  plan, then implement it. Use this whenever the user wants to continue the
  Parobek roadmap or build the next thing — e.g. "next feature", "what's
  next", "continue the roadmap", "implement the next roadmap feature", "let's
  build the next one", "co dalej", "następny feature", "kontynuuj roadmapę", or
  when a fresh window/agent is opened to keep working through `roadmap/`. Trigger
  it even if the user doesn't name a specific feature — picking the next one is
  this skill's job.
---

# next-feature — drive the Parobek roadmap

This repo plans its post-MVP work as a checklist of features in
[`roadmap/`](../../../roadmap/). This skill is the loop that turns one checklist
item into shipped code. It is written to run **cold** — in a brand-new window with
no prior conversation — so it re-derives everything it needs from the repo.

Work through four phases **in order**. Do not skip ahead to code.

---

## Phase 1 — Pick the next feature

1. Read [`roadmap/README.md`](../../../roadmap/README.md). It holds the **master
   checklist** and the **recommended build order**.
2. The "next feature" is the **first unchecked (`- [ ]`) item walking the recommended
   build order**, not just top-to-bottom of the checklist. The build order exists
   because features depend on each other (e.g. nothing works before F1.1 ships the
   tier config).
3. Open that feature's file (e.g. `roadmap/epic-1-tiered-savings/F1.1-*.md`) and read
   its **Depends on** line. If a dependency is still unchecked, that dependency is the
   real next feature — back up to it. Never start a feature whose dependencies aren't
   done.
4. State your pick to the user in one line: the feature id, title, tier, and why it's
   next (e.g. "F1.1 is next — it's the foundation every other feature gates on"). This
   opens the discussion; don't silently proceed.

If the user named a specific feature, use that one instead (still check its
dependencies and warn if they're unmet).

---

## Phase 2 — Discuss in plan mode

Enter plan mode (call `EnterPlanMode`) before discussing, so nothing is edited while
you and the user align.

Load context first so the discussion is grounded, not hand-wavy:

- The feature file itself (goal, mechanism, files, feasibility, acceptance).
- Its epic `README.md` (where it sits, cross-feature dependencies).
- [`roadmap/tiers.md`](../../../roadmap/tiers.md) — the Safe/Balanced/Max model and
  the config mechanism, since most features gate on the tier.
- [`CLAUDE.md`](../../../CLAUDE.md) — the hard architectural constraints (what a
  plugin can/can't do) and the conventions.
- The actual source files the feature's **reuse map** names (e.g.
  `plugins/parobek/scripts/lib/config.mjs`). Read them — the roadmap describes
  intent, the code is the truth.

Then discuss with the user. Use `AskUserQuestion` for genuine forks the feature file
left open — e.g. exact config key names, thresholds/defaults, command sub-syntax,
how aggressive a tier behavior should be. Recommend a default for each; don't dump
every option. Resolve the open questions in the feature's "Feasibility / risk"
section here, because those are where the plan can go wrong.

---

## Phase 3 — Write the implementation plan

Still in plan mode, write the plan (to the plan file the harness provides). A good
plan for this repo:

- **Context** — the feature, its tier, and what it unblocks.
- **Changes** — concrete files to add/edit, mapped to the reuse targets. Prefer
  extending existing `lib/` modules over new ones; match the surrounding style.
- **Tests** — which `node:test` files to add under
  `plugins/parobek/scripts/__tests__/`, using the existing `mock-server.mjs`
  (no live model) and `helpers/run.mjs` (spawn real scripts with a temp `HOME`).
- **Verification** — the exact `npm test` / smoke commands to run.
- **Checklist update** — note that completion ticks the boxes (Phase 4).

Keep it scannable. Then call `ExitPlanMode` to get approval. Do not implement before
the user approves.

---

## Phase 4 — Implement

After approval, build it following the repo's hard rules (see `CLAUDE.md`):

- **Node ESM (`.mjs`), zero runtime dependencies** — global `fetch`, Node 18+ only.
- **All code and comments in English.**
- Reach the local server only through the provider facade
  (`lib/provider.mjs`); never hit `fetch` directly from a command/hook.
- Every user-facing line carries the `[Parobek]` prefix — use `lib/brand.mjs`
  (`say`/`tag`/`TAG`).
- Commands are thin `.md` wrappers over a `scripts/*.mjs` entry point; hooks read a
  JSON event on stdin via `lib/hookio.mjs` and self-gate on the tier with
  `featureEnabled` from `lib/config.mjs`.
- Mirror the proven patterns: state keyed by `cwdHash` in `lib/state.mjs`; the
  `PRESETS` merge-and-strip idiom for any new code-owned-plus-custom config; the
  prompt-module style of `lib/compact-prompt.mjs`.

Add tests alongside the code and run them:

```bash
cd plugins/parobek && npm test
```

**When it's green, update the roadmap — this is part of the task, not an afterthought**
(the convention is in `CLAUDE.md`). Tick the box in **all three** places so status
never drifts:

1. the feature file's `Status` line (`- [ ]` → `- [x]`),
2. its epic `README.md` feature checklist,
3. the master checklist in `roadmap/README.md`.

Then tell the user what shipped and what the *next* unchecked feature now is (so they
can re-run this skill). If the change touched `hooks/hooks.json`, a hook script, or
`plugin.json`, remind them: **hooks and MCP servers load at session start — restart
Claude Code to pick the change up.** A skill can't restart it for them.

---

## Scope guardrails

- **One feature per run.** The roadmap is sized so each `F*.md` is a self-contained
  unit. Don't bundle the next one in "while I'm here" — finishing one cleanly, tests
  and checkboxes included, beats two half-done.
- If, mid-implementation, the feature file turns out to be wrong about the code
  (e.g. a named function doesn't exist), stop and surface it — update the plan with
  the user rather than silently improvising a different design.
- Don't invent features that aren't in `roadmap/`. If the user wants something new,
  that's a roadmap edit first, then this skill.
