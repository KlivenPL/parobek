// local_extract — mechanical structured extraction from text into JSON matching a
// caller-supplied schema. On a non-JSON model response it returns the raw text with
// a note instead of failing (never throws for a parse error). Tier 1.

import { resolveInput } from '../lib/inputs.mjs'
import { runDigest } from '../../scripts/lib/digest.mjs'
import { getExtractPrompt, parseExtractResult } from '../../scripts/lib/digest-prompt.mjs'

export const extract = {
  name: 'local_extract',
  description:
    'Mechanically extract structured data (error codes, endpoints, TODOs, config ' +
    'keys, …) from text into JSON matching a caller-supplied schema, using the local ' +
    'model. Args: `text` OR `path`, plus `schema` (a JSON-Schema object or a plain ' +
    'description of the fields). Returns JSON; if the model output is not valid JSON ' +
    'it returns the raw text with a note.',
  inputSchema: {
    type: 'object',
    properties: {
      text: { type: 'string', description: 'The text to extract from (use this or path).' },
      path: { type: 'string', description: 'Path to a file to extract from (use this or text).' },
      schema: { description: 'A JSON-Schema object or a plain description of the fields to extract.' },
    },
    required: ['schema'],
  },
  async handler(args, { config }) {
    const text = resolveInput(args)
    const raw = await runDigest(config, text, {
      finalPrompt: getExtractPrompt(args?.schema),
    })
    const parsed = parseExtractResult(raw)
    if ('value' in parsed) return JSON.stringify(parsed.value, null, 2)
    return (
      `Could not parse the extraction as JSON (${parsed.error}). ` +
      `Raw model output:\n${parsed.raw}`
    )
  },
}
