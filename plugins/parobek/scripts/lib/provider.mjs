// Provider dispatcher. Selects the local-server provider from `config.provider`
// and exposes a stable facade (same function names the commands already import),
// so call sites stay provider-agnostic and only pass `config`.

import * as openai from './providers/openai.mjs'
import * as lmstudio from './providers/lmstudio.mjs'
import * as ollama from './providers/ollama.mjs'

const PROVIDERS = { openai, lmstudio, ollama }

/** Resolve the provider module. Unknown/absent → lmstudio (default behavior). */
export function getProvider(config) {
  return PROVIDERS[config?.provider] ?? lmstudio
}

// Single shared error class so `instanceof LocalModelError` keeps matching
// regardless of which provider produced the error.
export const LocalModelError = openai.LocalModelError

export const listModels = (config, opts) => getProvider(config).listModels(config, opts)
export const chat = (config, messages, opts) => getProvider(config).chat(config, messages, opts)
export const ping = (config, opts) => getProvider(config).ping(config, opts)
export const isModelLoaded = (config, opts) => getProvider(config).isModelLoaded(config, opts)
export const modelContextLength = (config, opts) => getProvider(config).modelContextLength(config, opts)
