// local_read_digest — return only the relevant slice/structure of a file instead of
// its full contents: a targeted, compressed read via the local model. Tier 1.

import { readFileCapped } from '../lib/inputs.mjs'
import { runDigest } from '../../scripts/lib/digest.mjs'
import { getReadDigestPrompt } from '../../scripts/lib/digest-prompt.mjs'

export const readDigest = {
  name: 'local_read_digest',
  description:
    'Return only the relevant slice/structure of a file instead of its full ' +
    'contents — a targeted, compressed read via the local model (~0 Anthropic ' +
    'tokens). Prefer this over a raw Read of a large file, especially when you have ' +
    'a specific question about it. Args: `path` (required), optional `question`.',
  inputSchema: {
    type: 'object',
    properties: {
      path: { type: 'string', description: 'File to read and digest.' },
      question: { type: 'string', description: 'Optional question to focus the digest on.' },
    },
    required: ['path'],
  },
  async handler(args, { config }) {
    const { text } = readFileCapped(args?.path)
    return runDigest(config, text, { finalPrompt: getReadDigestPrompt(args?.question) })
  },
}
