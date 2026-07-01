// Parobek MCP stdio server.
//
// A hand-rolled, dependency-free JSON-RPC 2.0 server over stdin/stdout that
// advertises the plugin's local-LLM tools to Claude Code. Launched by Claude Code
// as `node ${CLAUDE_PLUGIN_ROOT}/mcp/server.mjs` (see plugin.json `mcpServers`).
//
// CRITICAL: stdout carries ONLY newline-delimited JSON-RPC frames. All diagnostics
// go to stderr (branded via tag()); a stray stdout write would corrupt the stream.
//
// The process is long-lived (unlike the one-shot command/hook scripts), so config
// is read FRESH on every tools/call to pick up edits without a restart.

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { createMessageReader, encodeMessage, result, errorResponse, RPC_ERRORS } from './lib/rpc.mjs'
import { tools, findTool } from './tools.mjs'
import { readConfigSafe } from '../scripts/lib/config.mjs'
import { tag } from '../scripts/lib/brand.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))

// Latest MCP protocol revision we implement; echoed back unless the client asks
// for a specific (supported) one in `initialize`.
const PROTOCOL_VERSION = '2025-03-26'

/** Read the plugin version from plugin.json (best effort; '0.0.0' on failure). */
function pluginVersion() {
  try {
    const path = join(HERE, '..', '.claude-plugin', 'plugin.json')
    return JSON.parse(readFileSync(path, 'utf8')).version ?? '0.0.0'
  } catch {
    return '0.0.0'
  }
}

const SERVER_INFO = { name: 'parobek-local', version: pluginVersion() }

/** Log a diagnostic line to stderr (never stdout). */
function logError(msg) {
  process.stderr.write(tag(msg) + '\n')
}

/** Write a response frame to stdout. */
function send(message) {
  process.stdout.write(encodeMessage(message))
}

/** Advertised tool list (protocol shape: no handler field). */
function toolList() {
  return tools.map(({ name, description, inputSchema }) => ({ name, description, inputSchema }))
}

/** Run a tool by name, returning an MCP `tools/call` result payload. */
async function callTool(params) {
  const name = params?.name
  const tool = findTool(name)
  if (!tool) return { notFound: true }
  // Fresh config per call: the server is long-lived, so honor edits made since
  // startup. readConfigSafe never throws (a corrupt file degrades to defaults).
  const { config, error } = readConfigSafe()
  if (error) logError(`config read warning: ${error}`)
  try {
    const text = await tool.handler(params?.arguments ?? {}, { config })
    return { content: [{ type: 'text', text: String(text) }] }
  } catch (err) {
    // Tool execution failure is a tool result with isError, NOT a JSON-RPC error
    // (per MCP convention — the model sees the message and can react).
    return { content: [{ type: 'text', text: tag(err?.message ?? String(err)) }], isError: true }
  }
}

/**
 * Dispatch one parsed message to a response object (or null for notifications /
 * messages that take no reply). Async because tools/call awaits the handler.
 */
async function dispatch(msg) {
  const { id, method, params } = msg ?? {}
  const isNotification = id === undefined || id === null

  switch (method) {
    case 'initialize': {
      const requested = params?.protocolVersion
      const protocolVersion = typeof requested === 'string' ? requested : PROTOCOL_VERSION
      return result(id, {
        protocolVersion,
        capabilities: { tools: {} },
        serverInfo: SERVER_INFO,
      })
    }
    case 'notifications/initialized':
    case 'initialized':
      return null // notification — no response
    case 'ping':
      return result(id, {})
    case 'tools/list':
      return result(id, { tools: toolList() })
    case 'tools/call': {
      const out = await callTool(params)
      if (out.notFound) {
        return errorResponse(id, RPC_ERRORS.INVALID_PARAMS, `Unknown tool: ${params?.name}`)
      }
      return result(id, out)
    }
    default:
      if (isNotification) return null // ignore unknown notifications silently
      return errorResponse(id, RPC_ERRORS.METHOD_NOT_FOUND, `Unknown method: ${method}`)
  }
}

// Track in-flight async dispatches so a stdin EOF (client closing the pipe) does
// not exit the process while a tools/call response is still being awaited.
let inFlight = 0
let ending = false
function maybeExit() {
  if (ending && inFlight === 0) process.exit(0)
}

const reader = createMessageReader({
  onMessage(obj) {
    inFlight++
    dispatch(obj)
      .then((response) => {
        if (response) send(response)
      })
      .catch((err) => {
        logError(`dispatch error: ${err?.message ?? err}`)
        if (obj?.id !== undefined && obj?.id !== null) {
          send(errorResponse(obj.id, RPC_ERRORS.INTERNAL_ERROR, 'Internal server error'))
        }
      })
      .finally(() => {
        inFlight--
        maybeExit()
      })
  },
  onParseError(err) {
    // Malformed frame: we cannot know the id, so respond with id null per JSON-RPC.
    logError(`parse error: ${err?.message ?? err}`)
    send(errorResponse(null, RPC_ERRORS.PARSE_ERROR, 'Parse error'))
  },
})

process.stdin.setEncoding('utf8')
process.stdin.on('data', (chunk) => reader.push(chunk))
process.stdin.on('end', () => {
  ending = true
  maybeExit()
})
