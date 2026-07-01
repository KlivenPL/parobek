// local_log_triage — condense a huge log, keeping errors/warnings/stack traces
// verbatim while dropping repetitive noise, via the local model. Tier 1.

import { readFileCapped } from '../lib/inputs.mjs'
import { runDigest } from '../../scripts/lib/digest.mjs'
import { getLogTriagePrompt } from '../../scripts/lib/digest-prompt.mjs'

export const logTriage = {
  name: 'local_log_triage',
  description:
    'Condense a huge log file, keeping every error, warning, and stack trace ' +
    'VERBATIM while dropping repetitive noise, using the local model (~0 Anthropic ' +
    'tokens). Prefer this over reading a large log in full when hunting a failure. ' +
    'Arg: `path`.',
  inputSchema: {
    type: 'object',
    properties: {
      path: { type: 'string', description: 'Path to the log file to triage.' },
    },
    required: ['path'],
  },
  async handler(args, { config }) {
    const { text } = readFileCapped(args?.path)
    return runDigest(config, text, { finalPrompt: getLogTriagePrompt() })
  },
}
