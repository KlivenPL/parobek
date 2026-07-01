// /local-model — select / inspect the local LLM used by /local-* commands.
//
// Usage (passed as a single "$ARGUMENTS" string by the slash command):
//   /local-model              list available models + current selection
//   /local-model list         same as above
//   /local-model status       print current config (endpoint, model, context)
//   /local-model preset <id>  switch endpoint preset (lmstudio | ollama | ...)
//   /local-model <model-id>   select a model for /local-* commands
//
// Output is plain text shown to the user in Claude Code. The selected model is
// NOT used for normal prompts — only by /local-* commands.

import {
  readConfigSafe,
  writeConfig,
  configSummaryLines,
  CONFIG_PATH,
  PRESETS,
} from './lib/config.mjs'
import { listModels, modelContextLength, LocalModelError } from './lib/provider.mjs'
import { deriveMaxOutputTokens } from './lib/tokens.mjs'
import { say } from './lib/brand.mjs'

function getArgs() {
  // The slash command passes the whole argument string as one argv entry.
  const raw = (process.argv[2] ?? '').trim()
  return raw.split(/\s+/).filter(Boolean)
}

async function showList(config) {
  let models
  try {
    models = await listModels(config)
  } catch (err) {
    const msg = err instanceof LocalModelError ? err.message : String(err)
    say(`⚠️  Could not list local models: ${msg}`)
    console.log(`Endpoint: ${config.endpoint}`)
    console.log(
      `Current selection: ${config.model || '(none — run /local-model <id>)'}`,
    )
    return
  }

  say(`local model server: ${config.endpoint}`)
  if (models.length === 0) {
    console.log('No models are currently loaded in the server.')
  } else {
    console.log('Available models:')
    for (const m of models) {
      const marker = m.id === config.model ? ' (selected)' : ''
      const ctx = m.contextLength ? `  [ctx ${m.contextLength}]` : ''
      console.log(`  - ${m.id}${ctx}${marker}`)
    }
  }
  if (!config.model) {
    say('No model selected yet. Run: /local-model <model-id>')
  }
}

function showStatus(config) {
  const [header, ...details] = configSummaryLines(config)
  say(header)
  for (const line of details) console.log(line)
}

async function setPreset(config, name) {
  const preset = config.presets?.[name] ?? PRESETS[name]
  if (!preset) {
    say(
      `Unknown preset "${name}". Known presets: ${Object.keys(
        config.presets ?? PRESETS,
      ).join(', ')}`,
    )
    return
  }
  config.endpoint = preset.endpoint
  config.apiKey = preset.apiKey
  config.provider = preset.provider ?? config.provider
  writeConfig(config)
  say(`✅ Switched to preset "${name}" → ${config.endpoint}`)
  console.log('Now select a model: /local-model <model-id>')
}

async function setModel(config, id) {
  config.model = id // set first so the context-length probe targets this model

  // Validate the id against the server (informational only — set it regardless).
  try {
    const models = await listModels(config)
    if (!models.some((m) => m.id === id)) {
      say(`⚠️  "${id}" is not in the server's loaded model list. Setting it anyway.`)
      const ids = models.map((m) => m.id)
      if (ids.length) console.log(`   Loaded models: ${ids.join(', ')}`)
    }
  } catch (err) {
    const msg = err instanceof LocalModelError ? err.message : String(err)
    say(`⚠️  Could not verify against the server: ${msg}`)
    console.log('   Setting the model anyway.')
  }

  // Auto-detect the context window (native for LM Studio / Ollama) and size
  // localContextTokens + maxOutputTokens from it, so the user never has to.
  const window = await modelContextLength(config)
  if (window) {
    config.localContextTokens = window
    config.maxOutputTokens = deriveMaxOutputTokens(window)
  }

  writeConfig(config)
  say(`✅ Local model set to: ${id}`)
  if (window) {
    console.log(`   detected context window: ${window} tokens`)
  } else {
    console.log('   context window not reported — keeping current localContextTokens.')
  }
  console.log(
    `   localContextTokens: ${config.localContextTokens}, ` +
      `maxOutputTokens: ${config.maxOutputTokens}`,
  )
  console.log('This model is used only by /local-* commands.')
}

async function main() {
  const { config, error } = readConfigSafe()
  if (error) {
    say(
      `Invalid plugin config: ${error}. Using built-in defaults until fixed — ` +
      `edit with /local-config, or delete ${CONFIG_PATH} to reset.`,
    )
  }
  const args = getArgs()
  const sub = args[0]?.toLowerCase()

  if (!sub || sub === 'list') return showList(config)
  if (sub === 'status') return showStatus(config)
  if (sub === 'preset') return setPreset(config, args[1])
  // Otherwise treat the first token as a model id (allow ids without spaces).
  return setModel(config, args[0])
}

main().catch((err) => {
  say(`error: ${err?.message ?? err}`)
  process.exit(0)
})
