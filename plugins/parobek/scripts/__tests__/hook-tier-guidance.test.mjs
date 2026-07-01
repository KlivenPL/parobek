// Integration tests for the F1.4 tier-guidance SessionStart hook. Spawns the real
// hook script with a temp HOME + seeded config and feeds a SessionStart event on
// stdin, asserting it self-gates on the savings tier.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { redirectHome, cleanupHome, seedConfig } from './helpers/env.mjs'
import { runScript } from './helpers/run.mjs'

const seedBase = { model: 'm', provider: 'openai', endpoint: 'http://127.0.0.1:1/v1' }
const event = (source = 'startup') =>
  JSON.stringify({ hook_event_name: 'SessionStart', source, cwd: process.cwd() })

test('tier-guidance: silent at Safe (tools exist but are not pushed)', async () => {
  const { home, stateDir } = redirectHome()
  try {
    seedConfig(stateDir, { ...seedBase, savingTier: 'safe' })
    const { stdout } = await runScript('tier-guidance.mjs', { home, stdin: event() })
    assert.equal(stdout.trim(), '', 'no output at Safe')
  } finally {
    cleanupHome(home)
  }
})

test('tier-guidance: injects branded guidance at Balanced', async () => {
  const { home, stateDir } = redirectHome()
  try {
    seedConfig(stateDir, { ...seedBase, savingTier: 'balanced' })
    const { stdout } = await runScript('tier-guidance.mjs', { home, stdin: event() })
    const out = JSON.parse(stdout)
    assert.equal(out.hookSpecificOutput.hookEventName, 'SessionStart')
    const ctx = out.hookSpecificOutput.additionalContext
    assert.match(ctx, /\[Parobek\]/)
    assert.match(ctx, /Balanced/)
    assert.match(ctx, /local_read_digest/)
    assert.doesNotMatch(ctx, /lean on these tools by default/) // Max-only phrasing
  } finally {
    cleanupHome(home)
  }
})

test('tier-guidance: stronger variant at Max', async () => {
  const { home, stateDir } = redirectHome()
  try {
    seedConfig(stateDir, { ...seedBase, savingTier: 'max' })
    const { stdout } = await runScript('tier-guidance.mjs', { home, stdin: event() })
    const ctx = JSON.parse(stdout).hookSpecificOutput.additionalContext
    assert.match(ctx, /Max/)
    assert.match(ctx, /lean on these tools by default/)
  } finally {
    cleanupHome(home)
  }
})

test('tier-guidance: ignores non-SessionStart events', async () => {
  const { home, stateDir } = redirectHome()
  try {
    seedConfig(stateDir, { ...seedBase, savingTier: 'max' })
    const stdin = JSON.stringify({ hook_event_name: 'UserPromptSubmit', cwd: process.cwd() })
    const { stdout } = await runScript('tier-guidance.mjs', { home, stdin })
    assert.equal(stdout.trim(), '')
  } finally {
    cleanupHome(home)
  }
})
