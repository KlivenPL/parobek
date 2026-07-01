// Prompts for /local-commit — draft a Conventional Commit message from the staged
// diff (the source of truth for WHAT changed) plus optional conversation context
// (the WHY). Same plain-text / no-tools framing as compact-prompt.mjs: a local
// model gets a single turn and must reply with the commit message only.

// Keep the model from emitting tool calls or chatter — we want raw message text.
const NO_TOOLS_PREAMBLE = `CRITICAL: Respond with the commit message TEXT ONLY.
Do NOT call any tools. Do NOT wrap the message in markdown code fences. Do NOT add
any preamble, explanation, or sign-off — output only the commit message itself.

`

const FORMAT_RULES = `Write ONE Conventional Commit message for the staged changes.

Format:
- Subject line: \`type(scope): summary\` where type is one of
  feat, fix, docs, style, refactor, perf, test, build, ci, chore, revert.
- scope is optional; use it when one area clearly dominates.
- Summary is imperative, lower-case, no trailing period, ≤ ~72 characters.

Grounding:
- The DIFF is the source of truth for WHAT changed. Describe only changes present
  in the diff — never invent or assume changes that are not shown.
- Use the conversation context (if any) ONLY to explain WHY / the intent. If there
  is no context, write the message from the diff alone.`

const VERBOSITY = {
  short: `Body: at most a few short bullet points ("- ...") capturing only the
non-obvious essentials. Omit the body entirely when the subject already says it
all. No filler, no restating the obvious.`,
  full: `Body: one or more prose paragraphs (wrapped at ~72 columns) explaining WHY
the change was made and any notable consequences or trade-offs. Still factual and
grounded in the diff.`,
}

/**
 * Build the final instruction appended after the diff (+ context) messages.
 * `verbosity` is 'short' | 'full'; `focus` is an optional free-text hint.
 */
export function getCommitPrompt(verbosity = 'short', focus = '') {
  const body = VERBOSITY[verbosity] ?? VERBOSITY.short
  let prompt = `${NO_TOOLS_PREAMBLE}${FORMAT_RULES}\n\n${body}`
  if (focus && focus.trim() !== '') {
    prompt += `\n\nExtra focus from the user: ${focus.trim()}`
  }
  prompt += `\n\nRespond with the commit message only.`
  return prompt
}

/**
 * "Map" step for a diff too large for a single pass: digest one group of file
 * diffs into factual "what changed" notes that the final compose step folds into
 * the commit message. No commit message is produced here.
 */
export function getDiffChunkPrompt(chunkIndex, chunkCount) {
  return (
    NO_TOOLS_PREAMBLE +
    `This is part ${chunkIndex} of ${chunkCount} of a larger staged diff being
summarized in pieces because it does not fit in one pass.

Write a short, factual digest of the changes in THIS part only: which files changed
and what was added/removed/modified, preserving symbol names. Do not write a commit
message yet and do not editorialize.

Respond with plain text only.`
  )
}

/**
 * Clean a raw model response into a usable commit message: drop a wrapping ```
 * code fence and any "Commit message:" label a weaker model may prepend, and
 * normalize blank runs.
 */
export function formatCommitMessage(raw) {
  let msg = String(raw ?? '').trim()
  const fence = msg.match(/^```[^\n]*\n([\s\S]*?)\n```$/)
  if (fence) msg = fence[1].trim()
  msg = msg.replace(/^(commit message|message)\s*:\s*/i, '')
  msg = msg.replace(/\n{3,}/g, '\n\n')
  return msg.trim()
}
