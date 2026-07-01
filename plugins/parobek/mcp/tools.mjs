// MCP tool registry. Each entry is { name, description, inputSchema, handler }.
// `tools/list` advertises name/description/inputSchema; `tools/call` dispatches to
// `handler(args, { config })`, which returns the result text (or throws — the
// server turns a throw into an isError tool result, never a protocol error).
//
// F3.1 ships only the `local_ping` health-check so the tools/call path is provable
// end-to-end. F3.2 appends the real digest/extract/search tools here; everything
// else (transport, dispatch, config-per-call) already works.

import { ping } from '../scripts/lib/provider.mjs'
import { resolveTier } from '../scripts/lib/config.mjs'

export const tools = [
  {
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
  },
]

/** Look up a tool by name (null when absent). */
export function findTool(name) {
  return tools.find((t) => t.name === name) ?? null
}
