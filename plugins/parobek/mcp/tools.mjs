// MCP tool registry. Each entry is { name, description, inputSchema, handler }.
// `tools/list` advertises name/description/inputSchema; `tools/call` dispatches to
// `handler(args, { config })`, which returns the result text (or throws — the
// server turns a throw into an isError tool result, never a protocol error).
//
// F3.1 shipped only the `local_ping` health-check to prove the tools/call path.
// F3.2 adds the mechanical digest/extract/search tools (each its own module under
// tools/); the transport, dispatch, and config-per-call already work. Each digest
// tool's description states when to prefer it over a raw Read/Grep — the always-on
// half of the "get Claude to actually use them" lever (the tier-scaled half is the
// SessionStart tier-guidance hook, F1.4).

import { ping } from '../scripts/lib/provider.mjs'
import { resolveTier } from '../scripts/lib/config.mjs'
import { summarize } from './tools/summarize.mjs'
import { readDigest } from './tools/read-digest.mjs'
import { extract } from './tools/extract.mjs'
import { grepDigest } from './tools/grep-digest.mjs'
import { outline } from './tools/outline.mjs'
import { logTriage } from './tools/log-triage.mjs'
import { diffDigest } from './tools/diff-digest.mjs'

const localPing = {
  name: 'local_ping',
  description:
    'Health-check the Parobek local LLM server: reports whether it is ' +
    'reachable plus the configured model, provider, and savings tier. Takes no ' +
    'arguments. Use to confirm the local copilot is up before relying on other ' +
    'local_* tools.',
  inputSchema: { type: 'object', properties: {}, required: [] },
  async handler(_args, { config }) {
    const reachable = await ping(config)
    const tier = resolveTier(config)
    return (
      `reachable: ${reachable} · ` +
      `model: ${config.model || '(none)'} · ` +
      `provider: ${config.provider} · ` +
      `tier: ${tier.key} (${tier.name}, lvl ${tier.level})`
    )
  },
}

export const tools = [
  localPing,
  summarize,
  readDigest,
  extract,
  grepDigest,
  outline,
  logTriage,
  diffDigest,
]

/** Look up a tool by name (null when absent). */
export function findTool(name) {
  return tools.find((t) => t.name === name) ?? null
}
