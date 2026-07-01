// local_summarize — condense a large blob (file / log / diff / web dump / pasted
// text) into a compact digest with the local model. Pure compression, tier 1.

import { resolveInput } from '../lib/inputs.mjs'
import { runDigest } from '../../scripts/lib/digest.mjs'
import { getSummarizePrompt } from '../../scripts/lib/digest-prompt.mjs'

export const summarize = {
  name: 'local_summarize',
  description:
    'Condense a large blob (a file, log, diff, web-page dump, or pasted text) into ' +
    'a compact digest using the local model at ~0 Anthropic-token cost. Prefer this ' +
    'over reading a large file or command output in full when you only need the gist. ' +
    'Provide `text` OR `path`, plus an optional `focus`.',
  inputSchema: {
    type: 'object',
    properties: {
      text: { type: 'string', description: 'The text to summarize (use this or path).' },
      path: { type: 'string', description: 'Path to a file to summarize (use this or text).' },
      focus: { type: 'string', description: 'Optional aspect to emphasize in the digest.' },
    },
  },
  async handler(args, { config }) {
    const text = resolveInput(args)
    return runDigest(config, text, { finalPrompt: getSummarizePrompt(args?.focus) })
  },
}
