// Hook (SessionStart + UserPromptSubmit): persist the current session's
// transcript path so /local-compact can locate the conversation later.
//
// We cannot pass the transcript path to a slash command directly, but hooks
// reliably receive it. We record {session_id, transcript_path, cwd} keyed by
// cwd. Emits nothing — it only writes state.

import { readHookInput } from './lib/hookio.mjs'
import { writeSessionRecord, clearWarnFlags } from './lib/state.mjs'

const input = await readHookInput()
const cwd = input.cwd || process.cwd()

if (input.transcript_path) {
  writeSessionRecord(cwd, {
    session_id: input.session_id ?? null,
    transcript_path: input.transcript_path,
  })
}

// A new/cleared/resumed session starts a fresh context-warning cycle.
if (input.hook_event_name === 'SessionStart') {
  clearWarnFlags(cwd)
}

process.exit(0)
