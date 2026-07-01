// Zero-dependency mock of a local LLM server (OpenAI-compatible + LM Studio /
// Ollama native routes). A real node:http server on 127.0.0.1 with an ephemeral
// port stands in for LM Studio/Ollama, so tests exercise the actual fetch path
// in providers without a running model. Every request is logged for assertions.
//
// Routes:
//   GET  /v1/models           -> { data: [{ id, context_length }] }
//   POST /v1/chat/completions -> { choices: [{ message: { content } }] }
//   GET  /api/v0/models       -> LM Studio native { data:[{id,state,loaded_context_length,max_context_length}] }
//   POST /api/show            -> Ollama native model info { model_info: { "<arch>.context_length": N } }
//   GET  /api/ps              -> Ollama native running list { models:[{name}] }
//   POST /api/generate        -> {} (Ollama keep_alive arming; body is logged)

import { createServer } from 'node:http'

/**
 * Start a mock server. `opts` overrides the default state:
 *   models:   [{ id, context_length }]    advertised by /v1/models + native routes
 *   chat:     string                       content returned by /chat/completions
 *   chatSequence: string[]                 consumed one-per-chat-call (then falls
 *                                          back to `chat`); lets one spawned run
 *                                          see different responses (e.g. retry)
 *   loadState:'loaded'|'not-loaded'        LM Studio /api/v0/models state
 *   running:  [{ name }]                   Ollama /api/ps running models
 *   chatStatus: number                     force a non-200 chat response
 *   emptyChat: boolean                     return an empty completion
 * Returns { url, port, requests, state, close() }. Mutate `state` between calls
 * to change behavior mid-test.
 */
export async function startMockServer(opts = {}) {
  const state = {
    models: opts.models ?? [{ id: 'test-model', context_length: 4096 }],
    chat: opts.chat ?? 'A local summary.',
    chatSequence: opts.chatSequence ?? null,
    loadState: opts.loadState ?? 'loaded',
    running: opts.running ?? [{ name: 'test-model' }],
    chatStatus: opts.chatStatus ?? 200,
    emptyChat: opts.emptyChat ?? false,
  }
  const requests = []

  const server = createServer((req, res) => {
    let body = ''
    req.on('data', (c) => (body += c))
    req.on('end', () => {
      let parsed
      try {
        parsed = body ? JSON.parse(body) : undefined
      } catch {
        parsed = body
      }
      requests.push({
        method: req.method,
        path: req.url,
        auth: req.headers['authorization'],
        body: parsed,
      })

      const send = (status, obj) => {
        res.writeHead(status, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify(obj))
      }

      if (req.method === 'GET' && req.url === '/v1/models') {
        return send(200, { data: state.models })
      }
      if (req.method === 'POST' && req.url === '/v1/chat/completions') {
        if (state.chatStatus !== 200) return send(state.chatStatus, { error: 'forced' })
        let content
        if (state.emptyChat) content = ''
        else if (Array.isArray(state.chatSequence) && state.chatSequence.length)
          content = state.chatSequence.shift()
        else content = state.chat
        return send(200, { choices: [{ message: { role: 'assistant', content } }] })
      }
      if (req.method === 'GET' && req.url === '/api/v0/models') {
        return send(200, {
          data: state.models.map((m) => ({
            id: m.id,
            state: state.loadState,
            loaded_context_length: m.context_length,
            max_context_length: m.context_length,
          })),
        })
      }
      if (req.method === 'POST' && req.url === '/api/show') {
        const m = state.models.find((x) => x.id === parsed?.model)
        const info = m?.context_length ? { 'test.context_length': m.context_length } : {}
        return send(200, { model_info: info })
      }
      if (req.method === 'GET' && req.url === '/api/ps') {
        return send(200, { models: state.running })
      }
      if (req.method === 'POST' && req.url === '/api/generate') {
        return send(200, {})
      }
      return send(404, { error: 'not found' })
    })
  })

  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  const port = server.address().port
  return {
    port,
    url: `http://127.0.0.1:${port}/v1`,
    requests,
    state,
    close: () => new Promise((resolve) => server.close(resolve)),
  }
}
