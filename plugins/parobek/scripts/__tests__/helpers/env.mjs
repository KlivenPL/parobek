// Test isolation helpers.
//
// The plugin stores all runtime state under `join(homedir(), '.claude',
// 'parobek')`, computed once when config.mjs is first imported. `homedir()`
// reads USERPROFILE (Windows) / HOME (POSIX) at call time, so we redirect both
// to a throwaway temp directory BEFORE config.mjs is imported. The module then
// binds its STATE_DIR inside the temp dir and the user's real
// ~/.claude/parobek/ is never touched.
//
// Usage in a test file (redirect must precede the first import of config/state):
//
//   import { redirectHome, cleanupHome } from './helpers/env.mjs'
//   const ctx = redirectHome()                       // top-level, before...
//   const cfg = await import('../../lib/config.mjs')  // ...this dynamic import
//
// node:test runs each *.test.mjs file in its own process, so one temp home per
// file is sufficient.

import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

/**
 * Point USERPROFILE/HOME at a fresh temp dir and return its path plus the
 * resolved STATE_DIR / CONFIG_PATH underneath it. Call this BEFORE importing
 * any module that reads STATE_DIR.
 */
export function redirectHome() {
  const home = mkdtempSync(join(tmpdir(), 'parobek-test-'))
  process.env.USERPROFILE = home
  process.env.HOME = home
  const stateDir = join(home, '.claude', 'parobek')
  return { home, stateDir, configPath: join(stateDir, 'config.json') }
}

/** Recursively remove a temp home created by redirectHome(). Best effort. */
export function cleanupHome(home) {
  try {
    rmSync(home, { recursive: true, force: true })
  } catch {
    /* best effort */
  }
}

/** Ensure the state dir exists and write a config.json into it. */
export function seedConfig(stateDir, config) {
  mkdirSync(stateDir, { recursive: true })
  writeFileSync(join(stateDir, 'config.json'), JSON.stringify(config, null, 2), 'utf8')
}
