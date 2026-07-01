import { test, before, after, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import * as openai from '../lib/providers/openai.mjs'
import * as lmstudio from '../lib/providers/lmstudio.mjs'
import * as ollama from '../lib/providers/ollama.mjs'
import { startMockServer } from './helpers/mock-server.mjs'
import { makeConfig } from './helpers/fixtures.mjs'

let srv
before(async () => {
  srv = await startMockServer()
})
after(() => srv.close())
beforeEach(() => {
  srv.requests.length = 0
  // reset state each test
  srv.state.chatStatus = 200
  srv.state.emptyChat = false
  srv.state.loadState = 'loaded'
  srv.state.running = [{ name: 'test-model' }]
})

test('joinUrl: normalizes slashes', () => {
  assert.equal(openai.joinUrl('http://h/v1/', '/models'), 'http://h/v1/models')
  assert.equal(openai.joinUrl('http://h/v1', 'models'), 'http://h/v1/models')
})

test('listModels: maps id + context length from data', async () => {
  const models = await openai.listModels(makeConfig(srv.url))
  assert.deepEqual(models, [{ id: 'test-model', contextLength: 4096 }])
})

test('request: non-200 -> LocalModelError with status', async () => {
  srv.state.chatStatus = 500
  await assert.rejects(
    () => openai.chat(makeConfig(srv.url), [{ role: 'user', content: 'hi' }]),
    (err) => err instanceof openai.LocalModelError && /500/.test(err.message),
  )
})

test('request: unreachable server -> LocalModelError', async () => {
  await assert.rejects(
    () => openai.listModels(makeConfig('http://127.0.0.1:1/v1')),
    (err) => err instanceof openai.LocalModelError && /Cannot reach/.test(err.message),
  )
})

test('ping: true when reachable, false when not', async () => {
  assert.equal(await openai.ping(makeConfig(srv.url)), true)
  assert.equal(await openai.ping(makeConfig('http://127.0.0.1:1/v1')), false)
})

test('baseChat: returns assistant content', async () => {
  srv.state.chat = 'hello world'
  const out = await openai.chat(makeConfig(srv.url), [{ role: 'user', content: 'hi' }])
  assert.equal(out, 'hello world')
})

test('baseChat: empty completion -> LocalModelError', async () => {
  srv.state.emptyChat = true
  await assert.rejects(
    () => openai.chat(makeConfig(srv.url), [{ role: 'user', content: 'hi' }]),
    (err) => err instanceof openai.LocalModelError && /empty response/.test(err.message),
  )
})

test('baseChat: no model selected -> LocalModelError', async () => {
  await assert.rejects(
    () => openai.chat(makeConfig(srv.url, { model: '' }), [{ role: 'user', content: 'hi' }]),
    (err) => err instanceof openai.LocalModelError && /No local model selected/.test(err.message),
  )
})

test('ensureLeadingUser: primer inserted when conversation starts with assistant', async () => {
  await openai.chat(makeConfig(srv.url), [{ role: 'assistant', content: 'opening' }])
  const chatReq = srv.requests.find((r) => r.path === '/v1/chat/completions')
  assert.equal(chatReq.body.messages[0].role, 'user')
  assert.match(chatReq.body.messages[0].content, /Start of the conversation/)
})

test('autoModelLoad=false + not loaded -> refuse (no chat call)', async () => {
  srv.state.loadState = 'not-loaded'
  await assert.rejects(
    () =>
      lmstudio.chat(makeConfig(srv.url, { autoModelLoad: false }), [
        { role: 'user', content: 'hi' },
      ]),
    (err) => err instanceof openai.LocalModelError && /not loaded/.test(err.message),
  )
  assert.equal(srv.requests.some((r) => r.path === '/v1/chat/completions'), false)
})

test('lmstudio.isModelLoaded: native state drives result', async () => {
  srv.state.loadState = 'loaded'
  assert.equal(await lmstudio.isModelLoaded(makeConfig(srv.url)), true)
  srv.state.loadState = 'not-loaded'
  assert.equal(await lmstudio.isModelLoaded(makeConfig(srv.url)), false)
})

test('lmstudio.chat: sends ttl when autoUnloadMinutes>0, omits when 0', async () => {
  await lmstudio.chat(makeConfig(srv.url, { autoUnloadMinutes: 15 }), [
    { role: 'user', content: 'hi' },
  ])
  let chatReq = srv.requests.find((r) => r.path === '/v1/chat/completions')
  assert.equal(chatReq.body.ttl, 900)

  srv.requests.length = 0
  await lmstudio.chat(makeConfig(srv.url, { autoUnloadMinutes: 0 }), [
    { role: 'user', content: 'hi' },
  ])
  chatReq = srv.requests.find((r) => r.path === '/v1/chat/completions')
  assert.equal('ttl' in chatReq.body, false)
})

test('ollama.isModelLoaded: matches name or model in /api/ps', async () => {
  srv.state.running = [{ name: 'test-model' }]
  assert.equal(await ollama.isModelLoaded(makeConfig(srv.url, { provider: 'ollama' })), true)
  srv.state.running = [{ model: 'test-model' }]
  assert.equal(await ollama.isModelLoaded(makeConfig(srv.url, { provider: 'ollama' })), true)
  srv.state.running = [{ name: 'other' }]
  assert.equal(await ollama.isModelLoaded(makeConfig(srv.url, { provider: 'ollama' })), false)
})

test('ollama.chat: arms keep_alive via /api/generate (best effort)', async () => {
  const out = await ollama.chat(makeConfig(srv.url, { provider: 'ollama', autoUnloadMinutes: 10 }), [
    { role: 'user', content: 'hi' },
  ])
  assert.equal(out, srv.state.chat)
  const armReq = srv.requests.find((r) => r.path === '/api/generate')
  assert.ok(armReq)
  assert.equal(armReq.body.keep_alive, '10m')
})

test('ollama.chat: keep_alive arming never throws even if native route fails', async () => {
  // autoUnloadMinutes=0 -> arming is skipped entirely; chat still succeeds.
  const out = await ollama.chat(makeConfig(srv.url, { provider: 'ollama', autoUnloadMinutes: 0 }), [
    { role: 'user', content: 'hi' },
  ])
  assert.equal(out, srv.state.chat)
  assert.equal(srv.requests.some((r) => r.path === '/api/generate'), false)
})

test('baseChat: sends hardcoded anti-repetition penalties (normal tier)', async () => {
  await openai.chat(makeConfig(srv.url), [{ role: 'user', content: 'hi' }])
  const req = srv.requests.find((r) => r.path === '/v1/chat/completions')
  assert.equal(req.body.frequency_penalty, 0.3)
  assert.equal(req.body.presence_penalty, 0.3)
})

test('baseChat: strong tier raises penalties via opts.antiRepeat', async () => {
  await openai.chat(makeConfig(srv.url), [{ role: 'user', content: 'hi' }], { antiRepeat: 'strong' })
  const req = srv.requests.find((r) => r.path === '/v1/chat/completions')
  assert.equal(req.body.frequency_penalty, 0.6)
  assert.equal(req.body.presence_penalty, 0.6)
})

test('lmstudio.chat: sends repeat_penalty (normal 1.1, strong 1.3) alongside ttl', async () => {
  await lmstudio.chat(makeConfig(srv.url, { autoUnloadMinutes: 15 }), [
    { role: 'user', content: 'hi' },
  ])
  let req = srv.requests.find((r) => r.path === '/v1/chat/completions')
  assert.equal(req.body.repeat_penalty, 1.1)
  assert.equal(req.body.ttl, 900)

  srv.requests.length = 0
  await lmstudio.chat(makeConfig(srv.url), [{ role: 'user', content: 'hi' }], { antiRepeat: 'strong' })
  req = srv.requests.find((r) => r.path === '/v1/chat/completions')
  assert.equal(req.body.repeat_penalty, 1.3)
})

test('ollama.chat: sends repeat_penalty', async () => {
  await ollama.chat(makeConfig(srv.url, { provider: 'ollama' }), [{ role: 'user', content: 'hi' }])
  const req = srv.requests.find((r) => r.path === '/v1/chat/completions')
  assert.equal(req.body.repeat_penalty, 1.1)
})

test('openai.modelContextLength: reads contextLength from /v1/models', async () => {
  const ctx = await openai.modelContextLength(makeConfig(srv.url))
  assert.equal(ctx, 4096)
})

test('lmstudio.modelContextLength: native /api/v0/models reports the window', async () => {
  srv.requests.length = 0
  const ctx = await lmstudio.modelContextLength(makeConfig(srv.url))
  assert.equal(ctx, 4096)
  assert.ok(srv.requests.some((r) => r.path === '/api/v0/models'))
})

test('ollama.modelContextLength: native /api/show reports the window', async () => {
  srv.requests.length = 0
  const ctx = await ollama.modelContextLength(makeConfig(srv.url, { provider: 'ollama' }))
  assert.equal(ctx, 4096)
  assert.ok(srv.requests.some((r) => r.path === '/api/show'))
})

test('modelContextLength: null when the model is not advertised', async () => {
  const ctx = await openai.modelContextLength(makeConfig(srv.url, { model: 'absent-model' }))
  assert.equal(ctx, null)
})
