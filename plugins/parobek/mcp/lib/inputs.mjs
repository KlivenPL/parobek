// Input helpers for the F3.2 MCP digest tools: read a file (size-capped), run
// ripgrep, run git diff, and resolve a { text | path } argument pair. Shell-outs
// use execFileSync (like scripts/local-commit.mjs) so the server stays
// dependency-free. On a missing binary or bad input they throw LocalModelError with
// a clear message; mcp/server.mjs turns a throw into an isError tool result, so the
// model sees the reason and can fall back to a raw Read/Grep.

import { readFileSync, statSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { LocalModelError } from '../../scripts/lib/provider.mjs'

// 8 MB: enough for large files/logs while keeping memory bounded. Oversize inputs
// are truncated here and then map-reduced by runDigest — never fatal.
const DEFAULT_MAX_BYTES = 8 * 1024 * 1024
const MAX_SHELL_BUFFER = 64 * 1024 * 1024

/**
 * Read a text file, capping at `maxBytes`. Returns { text, truncated, bytes }.
 * Throws LocalModelError when the path is missing or unreadable.
 */
export function readFileCapped(path, maxBytes = DEFAULT_MAX_BYTES) {
  if (!path || typeof path !== 'string') {
    throw new LocalModelError('a file `path` is required.')
  }
  let size
  try {
    size = statSync(path).size
  } catch (err) {
    throw new LocalModelError(`cannot read file: ${path} (${err?.message ?? err})`)
  }
  const buf = readFileSync(path)
  const truncated = buf.length > maxBytes
  const text = (truncated ? buf.subarray(0, maxBytes) : buf).toString('utf8')
  return { text, truncated, bytes: size }
}

/** Resolve a { text?, path? } argument pair to text (path is read, size-capped). */
export function resolveInput(args) {
  if (typeof args?.text === 'string' && args.text.trim() !== '') return args.text
  if (typeof args?.path === 'string' && args.path.trim() !== '') {
    return readFileCapped(args.path).text
  }
  throw new LocalModelError('provide `text` or `path`.')
}

/**
 * Run ripgrep for `pattern` (optionally under `path`), returning the match lines as
 * text. No matches → '' (ripgrep exits 1). Missing binary → a friendly error that
 * tells the model to use the built-in Grep instead.
 */
export function runRipgrep(pattern, path, { cwd } = {}) {
  if (!pattern || typeof pattern !== 'string') {
    throw new LocalModelError('a search `pattern` is required.')
  }
  const args = ['--line-number', '--no-heading', '--color', 'never', pattern]
  if (path && typeof path === 'string' && path.trim() !== '') args.push(path)
  try {
    return execFileSync('rg', args, { cwd, encoding: 'utf8', maxBuffer: MAX_SHELL_BUFFER })
  } catch (err) {
    if (err?.status === 1) return err.stdout ? String(err.stdout) : '' // no matches
    if (err?.code === 'ENOENT') {
      throw new LocalModelError(
        'ripgrep (rg) is not available to the local server — use the built-in Grep ' +
          'tool for this search.',
      )
    }
    const detail = err?.stderr?.toString?.() || err?.message || String(err)
    throw new LocalModelError(`ripgrep failed: ${detail.slice(0, 300)}`)
  }
}

/**
 * Run `git diff [ref]` in `cwd`, returning the diff text ('' when clean). `ref` may
 * be any diff argument (e.g. `HEAD~3`, a branch, `--staged`). Not a git repo /
 * missing git → a friendly error.
 */
export function runGitDiff(ref, { cwd } = {}) {
  const args = ['diff']
  if (ref && typeof ref === 'string' && ref.trim() !== '') args.push(ref.trim())
  try {
    return execFileSync('git', args, { cwd, encoding: 'utf8', maxBuffer: MAX_SHELL_BUFFER })
  } catch (err) {
    if (err?.code === 'ENOENT') {
      throw new LocalModelError('git is not available to the local server.')
    }
    const detail = err?.stderr?.toString?.() || err?.message || String(err)
    throw new LocalModelError(
      `git diff failed (not a git repository?): ${detail.slice(0, 300)}`,
    )
  }
}
