// Prompts for the F3.2 MCP digest tools.
//
// Each builder returns the FINAL user instruction appended after the content to be
// processed (the content itself is a separate message). Same plain-text / no-tools
// framing as compact-prompt.mjs and commit-prompt.mjs: the local model gets a single
// turn and must reply with the requested result only — never a tool call, never
// markdown chatter. Wording here is Parobek's own (see CLAUDE.md de-IP rule).

const TEXT_ONLY =
  'Respond with plain text only. Do NOT call any tools and do NOT add preamble, ' +
  'explanation, or sign-off — output only the requested result.'

/** local_summarize: pure compression of a blob into a faithful digest. */
export function getSummarizePrompt(focus = '') {
  let p =
    'Condense the content above into a compact, faithful digest that preserves its ' +
    'key facts, decisions, names, and concrete values (numbers, paths, identifiers). ' +
    'Drop filler and repetition; never invent anything not present. Keep it as short ' +
    'as it can be while staying complete.'
  if (focus && focus.trim() !== '') p += `\n\nEmphasize in particular: ${focus.trim()}`
  return `${p}\n\n${TEXT_ONLY}`
}

/** local_read_digest: return only the relevant slice/structure of a file. */
export function getReadDigestPrompt(question = '') {
  const base =
    question && question.trim() !== ''
      ? `From the file content above, return only the parts relevant to this ` +
        `question: "${question.trim()}". Quote the relevant lines or blocks verbatim ` +
        `where useful and give their location (the nearby symbol or heading). Omit ` +
        `everything unrelated.`
      : `Return a compact structural digest of the file content above: its main ` +
        `sections/symbols and what each is for, keeping only the parts that carry ` +
        `meaning. Quote short key lines verbatim; omit boilerplate.`
  return `${base}\n\n${TEXT_ONLY}`
}

/** local_extract: mechanical structured extraction into JSON matching a schema. */
export function getExtractPrompt(schema) {
  const schemaText =
    typeof schema === 'string' ? schema : JSON.stringify(schema ?? {}, null, 2)
  return (
    `Extract structured data from the content above into JSON matching this ` +
    `schema/shape:\n\n${schemaText}\n\n` +
    `Return ONLY the JSON value — no markdown fences, no commentary. Use only data ` +
    `present in the content; if a field is absent use null (or omit it when the ` +
    `schema allows). Never fabricate values.\n\n${TEXT_ONLY}`
  )
}

/** local_grep_digest: digest a set of ripgrep match lines. */
export function getGrepDigestPrompt(pattern) {
  return (
    `The lines above are ripgrep matches for the pattern \`${pattern}\`. Summarize ` +
    `what was found: group the hits by file, describe what each group shows, and ` +
    `call out the most relevant locations as file:line. Do not echo every raw line — ` +
    `digest them. Preserve exact identifiers.\n\n${TEXT_ONLY}`
  )
}

/** local_outline: structural outline without the body. */
export function getOutlinePrompt() {
  return (
    `Produce a structural outline of the file content above WITHOUT its full body. ` +
    `For prose or markdown, list the heading hierarchy. For code, list the top-level ` +
    `and nested declarations (functions, classes, methods, exported symbols) with ` +
    `their signatures, in source order. Keep each entry to a single line; do not ` +
    `include implementation bodies.\n\n${TEXT_ONLY}`
  )
}

/** local_log_triage: condense a log, keeping errors/traces verbatim. */
export function getLogTriagePrompt() {
  return (
    `Triage the log content above. Keep every error, warning, exception, and stack ` +
    `trace VERBATIM — do not paraphrase them. Drop routine progress and noise lines, ` +
    `collapsing runs of near-identical lines into one line with a count. Preserve ` +
    `chronological order and any timestamps on the kept lines.\n\n${TEXT_ONLY}`
  )
}

/** local_diff_digest: per-file bullet summary of a git diff. */
export function getDiffDigestPrompt() {
  return (
    `Summarize the git diff above as a per-file bullet list. For each changed file ` +
    `give one bullet "- path: <what changed>" describing the substantive change ` +
    `(added/removed/modified functions, behavior, config), preserving symbol names. ` +
    `Do not reproduce the raw diff, and ignore pure whitespace/formatting churn.` +
    `\n\n${TEXT_ONLY}`
  )
}

/**
 * Generic "map" step prompt used by runDigest when an input is too large for one
 * pass: digest THIS chunk into factual notes the final step will fold together.
 */
export function getDigestChunkPrompt(index, count) {
  return (
    `This is part ${index} of ${count} of a larger input, split because it does not ` +
    `fit in one pass. Write a short, factual digest of THIS part only, preserving ` +
    `concrete details (names, numbers, code, errors, file paths). Do not editorialize.` +
    `\n\nRespond with plain text only.`
  )
}

/**
 * Parse a local_extract response into a JSON value. Strips an optional ``` fence,
 * then JSON.parse. On failure returns { raw, error } instead of throwing, so the
 * tool can hand back the model's text with a note rather than failing outright.
 * On success returns { value }.
 */
export function parseExtractResult(raw) {
  let text = String(raw ?? '').trim()
  const fence = text.match(/^```[^\n]*\n([\s\S]*?)\n```$/)
  if (fence) text = fence[1].trim()
  try {
    return { value: JSON.parse(text) }
  } catch (err) {
    return { raw: String(raw ?? ''), error: err?.message ?? String(err) }
  }
}
