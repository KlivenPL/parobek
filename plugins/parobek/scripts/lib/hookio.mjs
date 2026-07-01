// Shared helpers for hook scripts: read the JSON event from stdin and emit a
// well-formed hook response. All hooks receive their event payload as JSON on
// stdin; see https://docs.claude.com/en/docs/claude-code/hooks for the schema.

/** Read and parse the hook event JSON from stdin. Never throws. */
export async function readHookInput() {
  return new Promise((resolve) => {
    let data = ''
    process.stdin.setEncoding('utf8')
    process.stdin.on('data', (chunk) => {
      data += chunk
    })
    process.stdin.on('end', () => {
      try {
        resolve(JSON.parse(data || '{}'))
      } catch {
        resolve({})
      }
    })
    // If there is no stdin at all, resolve empty after a tick.
    process.stdin.on('error', () => resolve({}))
  })
}

/** Print a hook JSON response (only when there is something to say). */
export function emit(response) {
  process.stdout.write(JSON.stringify(response))
}
