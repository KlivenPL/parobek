// Ollama provider. Adds Ollama's native behaviors on top of the OpenAI-compatible
// base: load-state detection via `/api/ps` and idle auto-unload via `keep_alive`.

import * as base from './openai.mjs'

export const { LocalModelError, listModels, ping } = base

/** Server root (strip a trailing `/v1`) for Ollama's native REST API. */
function nativeRoot(config) {
  return config.endpoint.replace(/\/+$/, '').replace(/\/v1$/, '')
}

/**
 * Whether the selected model is currently loaded.
 *
 * Ollama's native `GET /api/ps` lists the models currently held in memory. When
 * that route is unavailable we fall back to the base `/v1/models` heuristic
 * (which only proves the model is installed, not loaded). Returns null when the
 * state cannot be determined.
 */
export async function isModelLoaded(config, { signal } = {}) {
  try {
    const res = await fetch(`${nativeRoot(config)}/api/ps`, {
      headers: { Authorization: `Bearer ${config.apiKey ?? 'local'}` },
      signal,
    })
    if (res.ok) {
      const json = await res.json()
      const running = Array.isArray(json?.models) ? json.models : []
      // Ollama reports names like "qwen3:8b"; match exact or the bare name.
      return running.some(
        (m) => m.name === config.model || m.model === config.model,
      )
    }
  } catch {
    /* native API not available — fall through to the /v1 heuristic */
  }
  return base.isModelLoaded(config, { signal })
}

/**
 * Reported context-window size of the selected model. Ollama's native
 * `POST /api/show` returns a `model_info` map whose context-length key is
 * architecture-prefixed (e.g. `qwen2.context_length`, `llama.context_length`),
 * so pick the first key ending in `context_length`. Falls back to the base `/v1`
 * heuristic, then null.
 */
export async function modelContextLength(config, { signal } = {}) {
  try {
    const res = await fetch(`${nativeRoot(config)}/api/show`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${config.apiKey ?? 'local'}`,
      },
      body: JSON.stringify({ model: config.model }),
      signal,
    })
    if (res.ok) {
      const json = await res.json()
      const info = json?.model_info ?? {}
      for (const [k, v] of Object.entries(info)) {
        if (k.endsWith('context_length') && typeof v === 'number' && v > 0) return v
      }
    }
  } catch {
    /* native API not available — fall through to the base heuristic */
  }
  return base.modelContextLength(config, { signal })
}

/**
 * Arm Ollama's idle-unload timer. Ollama's OpenAI-compatible `/v1` path does NOT
 * honor `keep_alive` (it is absent from the documented `/v1` request fields, and
 * opencode#2979 was closed "not planned"). The native mechanism is `keep_alive`
 * on `/api/generate` / `/api/chat`. Posting `/api/generate` with an empty prompt
 * is the documented way to (re)arm a model's idle timer without running
 * inference — so after the `/v1` chat we fire a best-effort native call to set
 * the timer to `autoUnloadMinutes`. Non-fatal: a server without the native route
 * (or a non-Ollama OpenAI server addressed via this provider) just leaves the
 * server's own default in place.
 */
async function armKeepAlive(config, { signal } = {}) {
  const minutes = config.autoUnloadMinutes
  if (typeof minutes !== 'number' || minutes <= 0) return
  try {
    await fetch(`${nativeRoot(config)}/api/generate`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${config.apiKey ?? 'local'}`,
      },
      body: JSON.stringify({ model: config.model, prompt: '', keep_alive: `${minutes}m` }),
      signal,
    })
  } catch {
    /* best-effort: never let auto-unload arming break summarization */
  }
}

/**
 * Chat with Ollama, then best-effort arm the native idle-unload timer. Sends the
 * llama.cpp-flavored `repeat_penalty` (anti-repetition tier); Ollama's `/v1`
 * accepts it as an extra body field.
 */
export async function chat(config, messages, opts = {}) {
  const extraBody = { repeat_penalty: base.antiRepeat(opts).repeatPenalty }
  const text = await base.baseChat(config, messages, opts, { isModelLoaded, extraBody })
  await armKeepAlive(config, opts)
  return text
}
