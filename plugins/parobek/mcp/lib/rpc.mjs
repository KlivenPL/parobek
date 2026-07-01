// Minimal JSON-RPC 2.0 framing + envelope helpers for the MCP stdio server.
//
// Claude Code's MCP client (the @modelcontextprotocol/sdk StdioClientTransport,
// spec 2025-03-26) frames messages as JSON-RPC 2.0 objects delimited by a single
// newline; messages never contain embedded newlines. We hand-roll the transport
// here so the server stays dependency-free (a plugin install has no `npm install`
// step for runtime deps — see CLAUDE.md). This module is pure and side-effect free
// so it can be unit-tested without spawning a process.

/** Standard JSON-RPC 2.0 error codes (the subset this server emits). */
export const RPC_ERRORS = {
  PARSE_ERROR: -32700,
  INVALID_REQUEST: -32600,
  METHOD_NOT_FOUND: -32601,
  INVALID_PARAMS: -32602,
  INTERNAL_ERROR: -32603,
}

/** Serialize a message to a single newline-terminated frame. */
export function encodeMessage(obj) {
  return JSON.stringify(obj) + '\n'
}

/** Build a JSON-RPC success response envelope. */
export function result(id, payload) {
  return { jsonrpc: '2.0', id, result: payload }
}

/** Build a JSON-RPC error response envelope. */
export function errorResponse(id, code, message, data) {
  const error = { code, message }
  if (data !== undefined) error.data = data
  return { jsonrpc: '2.0', id, error }
}

/**
 * Create a line-delimited message reader. Feed it raw stdin chunks (string or
 * Buffer) via `push(chunk)`; it buffers across chunk boundaries, splits on `\n`,
 * and invokes the callbacks for each complete line:
 *   - onMessage(obj)   for a line that parses as JSON
 *   - onParseError(err, line) for a non-empty line that does not
 * Blank lines (and trailing whitespace-only lines) are ignored. A partial line
 * with no terminating newline stays buffered until the next chunk completes it.
 */
export function createMessageReader({ onMessage, onParseError } = {}) {
  let buffer = ''
  return {
    push(chunk) {
      buffer += typeof chunk === 'string' ? chunk : chunk.toString('utf8')
      let nl
      while ((nl = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, nl).trim()
        buffer = buffer.slice(nl + 1)
        if (line === '') continue
        let obj
        try {
          obj = JSON.parse(line)
        } catch (err) {
          onParseError?.(err, line)
          continue
        }
        onMessage?.(obj)
      }
    },
    /** Remaining buffered (incomplete) text — exposed for tests/diagnostics. */
    get pending() {
      return buffer
    },
  }
}
