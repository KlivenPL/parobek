// local_outline — a structural outline of a file (headings for prose, symbols with
// signatures for code) without the full body, via the local model. Tier 1.

import { readFileCapped } from '../lib/inputs.mjs'
import { runDigest } from '../../scripts/lib/digest.mjs'
import { getOutlinePrompt } from '../../scripts/lib/digest-prompt.mjs'

export const outline = {
  name: 'local_outline',
  description:
    "Produce a structural outline of a file — headings for prose/markdown, " +
    'top-level and nested symbols with their signatures for code — without the full ' +
    "body, using the local model. Use it to understand a file's shape before " +
    'deciding what to read in full. Arg: `path`.',
  inputSchema: {
    type: 'object',
    properties: {
      path: { type: 'string', description: 'File to outline.' },
    },
    required: ['path'],
  },
  async handler(args, { config }) {
    const { text } = readFileCapped(args?.path)
    return runDigest(config, text, { finalPrompt: getOutlinePrompt() })
  },
}
