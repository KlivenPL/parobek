// local_grep_digest — run ripgrep, then digest the hits so the model gets a summary
// of where/what matched instead of hundreds of raw match lines. Tier 1.

import { runRipgrep } from '../lib/inputs.mjs'
import { runDigest } from '../../scripts/lib/digest.mjs'
import { getGrepDigestPrompt } from '../../scripts/lib/digest-prompt.mjs'

export const grepDigest = {
  name: 'local_grep_digest',
  description:
    'Search with ripgrep, then digest the hits with the local model so you get a ' +
    'summary of where and what matched instead of hundreds of raw match lines ' +
    '(~0 Anthropic tokens). Prefer this over reading many files after a broad ' +
    'search. Args: `pattern` (required), optional `path`.',
  inputSchema: {
    type: 'object',
    properties: {
      pattern: { type: 'string', description: 'The ripgrep pattern to search for.' },
      path: { type: 'string', description: 'Optional file or directory to search under.' },
    },
    required: ['pattern'],
  },
  async handler(args, { config }) {
    const hits = runRipgrep(args?.pattern, args?.path)
    if (hits.trim() === '') return `No matches for pattern: ${args?.pattern}`
    return runDigest(config, hits, { finalPrompt: getGrepDigestPrompt(args?.pattern) })
  },
}
