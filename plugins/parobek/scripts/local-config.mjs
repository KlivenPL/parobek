// /local-config — open the Parobek config file in an editor, or reload it
// from disk with validation and print the effective config.
//
// Usage (passed as a single "$ARGUMENTS" string by the slash command):
//   /local-config              open ~/.claude/parobek/config.json in an editor
//   /local-config status       reload from disk, validate, print effective config
//   /local-config reload       alias of status
//   /local-config reset        factory reset (back up old file, write defaults)
//
// Rationale: every /local-* command and hook already reads the config fresh from
// disk on each run (one-shot processes — no daemon, no cache), so editing the
// file takes effect on the next invocation automatically. `status`/`reload` is a
// deliberate "confirm it parsed and is loaded" check, not a runtime reload.

import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import {
  readConfigSafe,
  writeConfig,
  resetConfig,
  configSummaryLines,
  CONFIG_PATH,
} from './lib/config.mjs'
import { say } from './lib/brand.mjs'

function getArg() {
  return (process.argv[2] ?? '').trim().toLowerCase()
}

/** status / reload: validate the file and print the effective config. */
function showStatus() {
  const { config, error } = readConfigSafe()
  if (error) {
    say(`Invalid plugin config: ${error}. Using built-in defaults until fixed.`)
    return
  }
  say(`config loaded OK from ${CONFIG_PATH}`)
  const [, ...details] = configSummaryLines(config)
  for (const line of details) console.log(line)
}

/** reset: back up the existing config, regenerate defaults, print the result. */
function resetToDefaults() {
  const { config, backupPath } = resetConfig()
  if (backupPath) {
    say('config reset to built-in defaults. Previous file backed up to:')
    console.log(`  ${backupPath}`)
  } else {
    say('config reset to built-in defaults (no previous file to back up).')
  }
  const [, ...details] = configSummaryLines(config)
  for (const line of details) console.log(line)
}

/** Launch the OS default editor/handler on the config file. */
function openInEditor() {
  // Each candidate is [command, args, useShell]. We honor $VISUAL/$EDITOR first
  // (the user's chosen terminal editor), then fall back to the OS default file
  // handler — whatever app is associated with .json on this machine.
  const candidates = []
  const envEditor = process.env.VISUAL || process.env.EDITOR
  if (envEditor) candidates.push([envEditor, [CONFIG_PATH], false])
  if (process.platform === 'win32') {
    // VS Code first when on PATH: `cmd /c start` always "succeeds" (cmd exits 0
    // even with no .json association), so it can't be the primary — it would
    // falsely report success while nothing opens. `code` is a .cmd shim, so it
    // needs shell:true; pass the whole command as one string (no args array) to
    // avoid the DEP0190 warning. Quotes tolerate spaces in the path.
    candidates.push([`code "${CONFIG_PATH}"`, [], true])
    candidates.push([`cmd /c start "" "${CONFIG_PATH}"`, [], true])
    candidates.push(['notepad', [CONFIG_PATH], false])
  } else if (process.platform === 'darwin') {
    candidates.push(['open', [CONFIG_PATH], false])
  } else {
    candidates.push(['xdg-open', [CONFIG_PATH], false])
  }

  let index = 0
  const tryNext = () => {
    if (index >= candidates.length) {
      say(`could not open an editor automatically — open it manually: ${CONFIG_PATH}`)
      return
    }
    const [cmd, args, useShell] = candidates[index++]
    let child
    try {
      child = spawn(cmd, args, {
        detached: true,
        stdio: 'ignore',
        shell: useShell,
        windowsHide: true,
      })
    } catch {
      tryNext()
      return
    }
    child.on('error', tryNext)
    // If spawn succeeds, detach and stop trying.
    child.on('spawn', () => {
      child.unref()
      say('✅ Opened in editor; run /local-config status after saving to confirm.')
    })
  }
  tryNext()
}

function main() {
  const arg = getArg()

  if (arg === 'status' || arg === 'reload') {
    showStatus()
    return
  }

  if (arg === 'reset') {
    resetToDefaults()
    return
  }

  // Default: open the file in an editor.
  const { config, error } = readConfigSafe()
  // Materialize the file with defaults when it does not exist yet, so the editor
  // opens an existing file. Never overwrite a file that exists but is corrupt —
  // open it so the user can fix it.
  if (!existsSync(CONFIG_PATH)) {
    writeConfig(config)
  }
  say(`config: ${CONFIG_PATH}`)
  if (error) {
    say(`⚠️ invalid JSON: ${error} — fix it in the editor.`)
  }
  openInEditor()
}

try {
  main()
} catch (err) {
  say(`error: ${err?.message ?? err}`)
  process.exit(0)
}
