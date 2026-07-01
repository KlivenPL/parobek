// Per-cwd runtime state: session records, pending summaries, and warning flags.
//
// Everything is keyed by a hash of the current working directory ("cwd-hash").
// Rationale (based on Claude Code's observed /clear behavior): /clear regenerates
// the session id and the SessionStart hook only receives the NEW id, so we cannot
// correlate a pre-clear /local-compact with the post-clear SessionStart by
// session id. The cwd is stable across /clear and is provided to the hook, so
// it is the only reliable correlation key. False-injection is prevented by the
// guards in inject-summary.mjs (source==='clear' + TTL + single-consume).

import { createHash } from 'node:crypto'
import { join } from 'node:path'
import {
  existsSync,
  readFileSync,
  writeFileSync,
  rmSync,
} from 'node:fs'
import { STATE_DIR, ensureStateDir } from './config.mjs'

/** Short, filesystem-safe hash of an absolute cwd path. */
export function cwdHash(cwd) {
  return createHash('sha1').update(cwd || '').digest('hex').slice(0, 16)
}

function sessionPath(cwd) {
  return join(STATE_DIR, `session-${cwdHash(cwd)}.json`)
}

function pendingPath(cwd) {
  return join(STATE_DIR, `pending-summary-${cwdHash(cwd)}.json`)
}

function warnFlagPath(cwd) {
  return join(STATE_DIR, `warn-${cwdHash(cwd)}.json`)
}

function readJson(path) {
  try {
    if (!existsSync(path)) return null
    return JSON.parse(readFileSync(path, 'utf8'))
  } catch {
    return null
  }
}

function writeJson(path, value) {
  ensureStateDir()
  writeFileSync(path, JSON.stringify(value, null, 2) + '\n', 'utf8')
}

function removeFile(path) {
  try {
    if (existsSync(path)) rmSync(path)
  } catch {
    /* best effort */
  }
}

// --- Session record: {session_id, transcript_path, cwd, updatedAt} -----------

export function writeSessionRecord(cwd, record) {
  writeJson(sessionPath(cwd), { ...record, cwd, updatedAt: Date.now() })
}

export function readSessionRecord(cwd) {
  return readJson(sessionPath(cwd))
}

// --- Pending summary: {createdAt, sourceSessionId, model, summary, passes} ----

export function writePendingSummary(cwd, pending) {
  writeJson(pendingPath(cwd), pending)
}

export function readPendingSummary(cwd) {
  return readJson(pendingPath(cwd))
}

export function clearPendingSummary(cwd) {
  removeFile(pendingPath(cwd))
}

// --- Context-warning flags: {fired: number[]} --------------------------------
// `fired` holds the warning fractions already shown this cycle, so each tier
// fires once. Reset after a successful compaction/clear so warnings re-arm.

export function readWarnFlags(cwd) {
  return readJson(warnFlagPath(cwd)) ?? { fired: [] }
}

export function writeWarnFlags(cwd, flags) {
  writeJson(warnFlagPath(cwd), flags)
}

export function clearWarnFlags(cwd) {
  removeFile(warnFlagPath(cwd))
}
