// Hook (SessionStart): after a /clear, inject the pending local summary as
// context, completing the /local-compact flow.
//
// Trigger safety guards (ALL must hold) — these prevent injecting into the wrong
// session, e.g. when the user merely opened a new window:
//   1. hook_event_name === 'SessionStart' AND source === 'clear'
//      (a new window is 'startup', --resume is 'resume', builtin /compact is
//       'compact' — none inject).
//   2. A pending summary exists for this exact cwd.
//   3. Freshness: created within pendingTtlMs (else discard + notify).
//   4. Single-consume: the pending file is deleted on injection.
//   5. The injected context is clearly labeled (never a silent change).

import { readHookInput, emit } from './lib/hookio.mjs'
import { readConfigSafe } from './lib/config.mjs'
import { readPendingSummary, clearPendingSummary } from './lib/state.mjs'
import { tag, TAG } from './lib/brand.mjs'

async function main() {
  const input = await readHookInput()
  const cwd = input.cwd || process.cwd()

  // Guard 1: only a real /clear injects.
  if (input.hook_event_name !== 'SessionStart' || input.source !== 'clear') {
    return
  }

  // Guard 2: a pending summary must exist for this cwd.
  const pending = readPendingSummary(cwd)
  if (!pending) return

  // A corrupt config falls back to defaults here (a hook emits a single response,
  // so we cannot also emit a standalone warning); the invalid-config warning is
  // surfaced by context-watch and the commands instead.
  const { config } = readConfigSafe()
  const age = Date.now() - (pending.createdAt ?? 0)

  // Guard 3: freshness. Expired pendings are discarded, not injected.
  if (age > (config.pendingTtlMs ?? 0)) {
    clearPendingSummary(cwd) // guard 4 (cleanup)
    emit({
      systemMessage: tag(
        'a local summary expired and was discarded — re-run /local-compact.',
      ),
    })
    return
  }

  // Guard 4: single-consume.
  clearPendingSummary(cwd)

  // Guard 5: clearly labeled injection.
  const shortId = (pending.sourceSessionId ?? '').toString().slice(0, 8) || 'unknown'
  const when = new Date(pending.createdAt).toLocaleString()
  const header =
    `${TAG} Local summary by ${pending.model} ` +
    `(from session ${shortId}, ${when}). Continue from where it left off.`
  const additionalContext = `${header}\n\n${pending.summary}`

  emit({
    hookSpecificOutput: {
      hookEventName: 'SessionStart',
      additionalContext,
    },
    systemMessage: tag(`✅ compacted context loaded (from session ${shortId}).`),
  })
}

main().catch(() => process.exit(0))
