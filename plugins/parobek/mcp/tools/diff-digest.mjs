// local_diff_digest — summarize a large git diff into per-file bullet points via the
// local model. Splits on `diff --git` so each file's changes stay intact. Tier 1.

import { runGitDiff } from '../lib/inputs.mjs'
import { runDigest } from '../../scripts/lib/digest.mjs'
import { getDiffDigestPrompt } from '../../scripts/lib/digest-prompt.mjs'

export const diffDigest = {
  name: 'local_diff_digest',
  description:
    'Summarize a large git diff into per-file bullet points using the local model ' +
    '(~0 Anthropic tokens). Prefer this over reading a full `git diff` when reviewing ' +
    'or describing changes. Arg: optional `ref` (e.g. HEAD~3, a branch name, or ' +
    '--staged); default is the working-tree diff.',
  inputSchema: {
    type: 'object',
    properties: {
      ref: { type: 'string', description: 'Optional git diff argument (ref/range/--staged).' },
    },
  },
  async handler(args, { config }) {
    const diff = runGitDiff(args?.ref)
    if (diff.trim() === '') return 'No changes in the git diff.'
    return runDigest(config, diff, {
      finalPrompt: getDiffDigestPrompt(),
      split: /(?=^diff --git )/m,
    })
  },
}
