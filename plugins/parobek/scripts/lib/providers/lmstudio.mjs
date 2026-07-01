// LM Studio provider. Adds the two LM-Studio-specific behaviors on top of the
// OpenAI-compatible base: native load-state detection and `ttl` auto-unload.

import * as base from './openai.mjs'

export const { LocalModelError, listModels, ping } = base

/**
 * Whether the selected model is currently loaded.
 *
 * LM Studio's native REST API (`/api/v0/models`) reports a `state` field
 * ("loaded" / "not-loaded"). That endpoint lives at the server root, not under
 * the OpenAI-compatible `/v1` base, so we strip a trailing `/v1`. When the
 * native API is unavailable we fall back to the base `/v1/models` heuristic.
 * Returns null when the state cannot be determined.
 */
export async function isModelLoaded(config, { signal } = {}) {
  const root = config.endpoint.replace(/\/+$/, '').replace(/\/v1$/, '')
  try {
    const res = await fetch(`${root}/api/v0/models`, {
      headers: { Authorization: `Bearer ${config.apiKey ?? 'local'}` },
      signal,
    })
    if (res.ok) {
      const json = await res.json()
      const data = Array.isArray(json?.data) ? json.data : []
      const entry = data.find((m) => m.id === config.model)
      if (entry && typeof entry.state === 'string') {
        return entry.state === 'loaded'
      }
    }
  } catch {
    /* native API not available — fall through to the /v1 heuristic */
  }
  return base.isModelLoaded(config, { signal })
}

/**
 * Reported context-window size of the selected model. LM Studio's `/v1/models`
 * usually omits it, so query the native `/api/v0/models` (same endpoint as the
 * load-state check), which exposes `loaded_context_length` when the model is
 * loaded and `max_context_length` otherwise. Falls back to the base `/v1`
 * heuristic, then null.
 */
export async function modelContextLength(config, { signal } = {}) {
  const root = config.endpoint.replace(/\/+$/, '').replace(/\/v1$/, '')
  try {
    const res = await fetch(`${root}/api/v0/models`, {
      headers: { Authorization: `Bearer ${config.apiKey ?? 'local'}` },
      signal,
    })
    if (res.ok) {
      const json = await res.json()
      const data = Array.isArray(json?.data) ? json.data : []
      const entry = data.find((m) => m.id === config.model)
      const ctx = entry?.loaded_context_length ?? entry?.max_context_length
      if (typeof ctx === 'number' && ctx > 0) return ctx
    }
  } catch {
    /* native API not available — fall through to the base heuristic */
  }
  return base.modelContextLength(config, { signal })
}

/**
 * Chat with LM Studio. Delegates idle auto-unload to the server via `ttl`
 * (seconds): LM Studio unloads the model after this many idle seconds, freeing
 * RAM, and resets the timer on every request so it stays loaded while in use.
 * Also sends the llama.cpp-flavored `repeat_penalty` (anti-repetition tier).
 */
export function chat(config, messages, opts = {}) {
  const minutes = config.autoUnloadMinutes
  const extraBody = { repeat_penalty: base.antiRepeat(opts).repeatPenalty }
  if (typeof minutes === 'number' && minutes > 0) {
    extraBody.ttl = Math.round(minutes * 60)
  }
  return base.baseChat(config, messages, opts, { isModelLoaded, extraBody })
}
