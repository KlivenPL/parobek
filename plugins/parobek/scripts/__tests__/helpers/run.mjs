// Spawn a plugin entry/hook script as a real child process and capture its
// output. Used by the integration tests so the scripts run end-to-end exactly
// as Claude Code invokes them (commands: arg in argv[2]; hooks: JSON on stdin).

import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const HERE = dirname(fileURLToPath(import.meta.url))
const SCRIPTS_DIR = join(HERE, '..', '..') // .../scripts

/**
 * Run `scripts/<name>` with the given argument string and HOME redirected to
 * `home` (so the script reads/writes the temp state dir). `stdin`, when given,
 * is written to the child's stdin (for hook scripts). Resolves with
 * { code, stdout, stderr }.
 */
export function runScript(name, { arg = '', home, stdin, cwd } = {}) {
  const scriptPath = join(SCRIPTS_DIR, name)
  const args = arg === '' ? [scriptPath] : [scriptPath, arg]
  const env = { ...process.env }
  if (home) {
    env.USERPROFILE = home
    env.HOME = home
  }
  const child = spawn(process.execPath, args, { env, cwd })

  let stdout = ''
  let stderr = ''
  child.stdout.on('data', (c) => (stdout += c))
  child.stderr.on('data', (c) => (stderr += c))

  if (stdin !== undefined) child.stdin.end(stdin)
  else child.stdin.end()

  return new Promise((resolve) => {
    child.on('close', (code) => resolve({ code, stdout, stderr }))
  })
}
