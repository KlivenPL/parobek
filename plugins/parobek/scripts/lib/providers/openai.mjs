// Base OpenAI-compatible client for a local LLM server. Provider-specific
// servers (LM Studio, Ollama) build on top of this module and only override the
// parts that are vendor-flavored (load-state detection, idle auto-unload).
//
// Uses Node 18+ global fetch — no third-party dependencies.

import { tag } from '../brand.mjs'

/**
 * Anti-repetition sampling penalties, hardcoded (NOT user-configurable — a user
 * would not knowingly tune these). Local models at low temperature with long
 * inputs are prone to degenerate repetition loops; these discourage it. Two
 * tiers: `normal` is sent on every request; `strong` is used by the one retry
 * /local-compact runs when the first response still looks degenerate.
 *
 * `frequencyPenalty`/`presencePenalty` are OpenAI-standard fields sent by the
 * base; `repeatPenalty` is the llama.cpp-flavored field that LM Studio and Ollama
 * accept, added by those providers via `extraBody`.
 */
export const ANTI_REPEAT = {
  normal: { frequencyPenalty: 0.3, presencePenalty: 0.3, repeatPenalty: 1.1 },
  strong: { frequencyPenalty: 0.6, presencePenalty: 0.6, repeatPenalty: 1.3 },
}

/** Resolve the anti-repeat tier object from caller opts (defaults to `normal`). */
export function antiRepeat(opts = {}) {
  return ANTI_REPEAT[opts.antiRepeat] ?? ANTI_REPEAT.normal
}

/** Error thrown when the local server cannot be reached or returns an error. */
export class LocalModelError extends Error {
  constructor(message, { cause, code } = {}) {
    super(message)
    this.name = 'LocalModelError'
    if (cause) this.cause = cause
    // Optional machine-readable discriminator (e.g. 'empty_response') so callers
    // can react to a specific failure without matching on the message string.
    if (code) this.code = code
  }
}

export function joinUrl(endpoint, path) {
  return `${endpoint.replace(/\/+$/, '')}/${path.replace(/^\/+/, '')}`
}

export async function request(config, path, { method = 'GET', body, signal } = {}) {
  const url = joinUrl(config.endpoint, path)
  let res
  try {
    res = await fetch(url, {
      method,
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${config.apiKey ?? 'local'}`,
      },
      body: body ? JSON.stringify(body) : undefined,
      signal,
    })
  } catch (cause) {
    throw new LocalModelError(
      `Cannot reach local model server at ${config.endpoint}. ` +
      `Is the local server running and started? (${cause.message})`,
      { cause },
    )
  }

  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new LocalModelError(
      `Local model server returned ${res.status} ${res.statusText} for ${path}` +
      (text ? `: ${text.slice(0, 500)}` : ''),
    )
  }
  return res.json()
}

/**
 * List available models. Returns an array of { id, contextLength? } objects.
 * Servers sometimes expose a context length under non-standard fields; we probe
 * a few common ones and leave it undefined when absent.
 */
export async function listModels(config, { signal } = {}) {
  const json = await request(config, '/models', { signal })
  const data = Array.isArray(json?.data) ? json.data : []
  return data.map((m) => ({
    id: m.id,
    contextLength:
      m.context_length ??
      m.max_context_length ??
      m.loaded_context_length ??
      m.context_window ??
      undefined,
  }))
}

/**
 * Reported context-window size (in tokens) of the selected model, or null when
 * the server does not advertise it. Generic baseline: read `contextLength` from
 * `/v1/models`. Provider modules override this with a native, accurate query and
 * fall back here when their native API is unavailable.
 */
export async function modelContextLength(config, { signal } = {}) {
  try {
    const models = await listModels(config, { signal })
    const ctx = models.find((m) => m.id === config.model)?.contextLength
    return typeof ctx === 'number' && ctx > 0 ? ctx : null
  } catch {
    return null
  }
}

/**
 * Generic load-state check: treat presence in `/v1/models` as "loaded". This is
 * the lowest-common-denominator heuristic for any OpenAI-compatible server.
 * Provider modules override this with a native, accurate check and fall back
 * here when their native API is unavailable. Returns null when undeterminable.
 */
export async function isModelLoaded(config, { signal } = {}) {
  try {
    const models = await listModels(config, { signal })
    return models.some((m) => m.id === config.model)
  } catch {
    return null
  }
}

/**
 * Workaround for a known Qwen3 chat-template bug. The template has a multi-step
 * tool-call guard that scans for a "plain" user query and, when it doesn't clear
 * the guard, raises `No user query found in messages.` (a 400 from the server).
 * It is documented across LM Studio and agent tools (opencode/openclaw) and is
 * triggered by conversations that don't lead with a normal user turn — exactly
 * our case, since a transcript can start with an assistant turn (e.g. a skill's
 * opening message). Empirically, inserting a user message ahead of the leading
 * assistant turn clears the guard; no-op when the conversation already starts
 * with a user message. See lmstudio-ai/lmstudio-bug-tracker#1586.
 *
 * This is a model-template quirk (not provider-specific), so it lives in the
 * base and is harmless for models that don't have the guard.
 */
function ensureLeadingUser(messages) {
  const first = messages.findIndex((m) => m.role !== 'system')
  if (first < 0 || messages[first].role !== 'assistant') return messages
  const primer = { role: 'user', content: '(Start of the conversation to summarize.)' }
  return [...messages.slice(0, first), primer, ...messages.slice(first)]
}

/**
 * Non-streaming chat completion shared by all providers. Returns the assistant
 * message text.
 *
 * The two vendor-flavored bits are injected by the caller so this stays neutral:
 *   - `isModelLoaded`: the provider's accurate load-state check (used by the
 *     autoModelLoad gate). Defaults to the generic `/v1/models` heuristic.
 *   - `extraBody`: provider-specific request-body fields (e.g. LM Studio's
 *     `ttl`). Merged into the chat payload.
 */
export async function baseChat(
  config,
  messages,
  opts = {},
  { isModelLoaded: isLoaded = isModelLoaded, extraBody = {} } = {},
) {
  const { signal } = opts
  if (!config.model) {
    throw new LocalModelError(
      'No local model selected. Run /local-model <model-id> first.',
    )
  }

  // Load gate: when auto-load is disabled, refuse to trigger a (slow, RAM-heavy)
  // JIT load and tell the user how to proceed. `null` (unknown state) is treated
  // as "allow", so an unreachable native API never blocks a normal run.
  if (config.autoModelLoad === false) {
    const loaded = await isLoaded(config, { signal })
    if (loaded === false) {
      throw new LocalModelError(
        tag(
          `model '${config.model}' is not loaded and autoModelLoad=false — ` +
          `load it in the local server or set autoModelLoad=true in the config.`,
        ),
      )
    }
  }

  const penalties = antiRepeat(opts)
  const body = {
    model: config.model,
    messages: ensureLeadingUser(messages),
    temperature: config.temperature ?? 0.2,
    max_tokens: config.maxOutputTokens ?? 8192,
    // Hardcoded anti-repetition penalties (OpenAI-standard fields; default 0, so
    // safe on any compatible server). repeat_penalty is added by LM Studio/Ollama.
    frequency_penalty: penalties.frequencyPenalty,
    presence_penalty: penalties.presencePenalty,
    stream: false,
    ...extraBody,
  }

  const json = await request(config, '/chat/completions', {
    method: 'POST',
    signal,
    body,
  })
  const content = json?.choices?.[0]?.message?.content
  if (typeof content !== 'string' || content.trim() === '') {
    throw new LocalModelError(
      'Local model returned an empty response (no summary text).',
      { code: 'empty_response' },
    )
  }
  return content
}

/** Base chat with no provider extras (used directly by the `openai` provider). */
export function chat(config, messages, opts = {}) {
  return baseChat(config, messages, opts)
}

/** Quick reachability probe used by preflight checks. */
export async function ping(config) {
  try {
    await listModels(config)
    return true
  } catch {
    return false
  }
}
