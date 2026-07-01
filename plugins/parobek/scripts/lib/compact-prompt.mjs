// Compaction prompt for /local-compact.
//
// This is Parobek's own prompt. It asks a local model to read the conversation
// so far and write a structured, developer-oriented summary that lets work
// continue after the live context is cleared. The reply is two plain-text
// blocks: an <analysis> scratchpad the model uses to think, followed by the
// <summary> we keep. Wording here is original — do not paste in prompt text
// from other tools.

// Aggressive no-tools preamble. We send the conversation to a local model with a
// single "turn" and want plain text only (an <analysis> block followed by a
// <summary> block), never a tool call.
const NO_TOOLS_PREAMBLE = `CRITICAL: Respond with TEXT ONLY. Do NOT call any tools.

- Do NOT use Read, Bash, Grep, Glob, Edit, Write, or ANY other tool.
- You already have all the context you need in the conversation above.
- Tool calls will be REJECTED and will waste your only turn — you will fail the task.
- Your entire response must be plain text: an <analysis> block followed by a <summary> block.

`

const DETAILED_ANALYSIS_INSTRUCTION_BASE = `First, think in an <analysis> block before you write the summary. This is scratch space to make sure nothing important is dropped. Work through it like this:

1. Go through the conversation in order, message by message. For each part, note:
   - what the user actually asked for, in their own terms;
   - how you responded and what you attempted;
   - the important decisions, techniques, and code patterns involved;
   - concrete details worth preserving — file paths, whole code snippets, function signatures, and exact edits;
   - any problems that came up and how they were handled;
   - direct feedback from the user, especially any moment they asked you to change course.
2. Then re-read your notes and confirm they are technically correct and complete before moving on.`

const BASE_COMPACT_PROMPT = `Write a detailed summary of the conversation up to this point. Focus on what the user asked for and on the actions you took in response.
The summary needs to preserve enough technical detail — decisions, code, and structure — that development can continue afterwards with nothing important lost.

${DETAILED_ANALYSIS_INSTRUCTION_BASE}

Organize the <summary> under these headings:

1. Goal and intent: What the user set out to achieve, capturing every explicit request and how their intent evolved.
2. Technical context: The key concepts, tools, languages, and frameworks that came up.
3. Files and code: The specific files and code regions that were read, changed, or created. Favor the most recent activity, quote full snippets where useful, and say briefly why each file mattered.
4. Problems and resolutions: The errors or blockers encountered and exactly how each was resolved. Call out any user feedback that redirected the work.
5. Reasoning and decisions: Problems that were worked through, the choices made, and any trade-offs or open threads.
6. User messages: Every message from the user that is not a tool result, listed out — these anchor the intent and any shifts in it.
7. Open tasks: Work the user has explicitly asked for that is not yet done.
8. In progress: Exactly what was being worked on right before this summary, with file names and snippets. Lean on the most recent messages.
9. Next step (optional): The single next action, only if it follows directly from the most recent work and the user's latest explicit request. Do not drift into old or tangential tasks without checking first. If you name a next step, quote the relevant recent lines so the intent stays exact.

Here is the shape the output should take:

<example>
<analysis>
[Your working notes, covering each point above carefully.]
</analysis>

<summary>
1. Goal and intent:
   [What the user wanted, in detail.]

2. Technical context:
   - [Concept / tool]
   - [...]

3. Files and code:
   - [Path]
      - [Why it matters]
      - [What changed, if anything]
      - [Relevant snippet]
   - [...]

4. Problems and resolutions:
   - [Problem]: [how it was resolved] [related user feedback, if any]
   - [...]

5. Reasoning and decisions:
   [Choices made, trade-offs, anything still unsettled.]

6. User messages:
   - [A non-tool-result user message]
   - [...]

7. Open tasks:
   - [Task]
   - [...]

8. In progress:
   [Precisely what was underway.]

9. Next step (optional):
   [The one next action, if it applies.]

</summary>
</example>

Follow this structure and keep the summary precise and complete.

The included context may carry extra summarization instructions. If it does, apply them on top of the structure above. For example:
<example>
## Compact Instructions
When summarizing the conversation focus on typescript code changes and also remember the mistakes you made and how you fixed them.
</example>

<example>
# Summary instructions
When you are using compact - please focus on test output and code changes. Include file reads verbatim.
</example>
`

const NO_TOOLS_TRAILER =
  '\n\nREMINDER: Do NOT call any tools. Respond with plain text only — ' +
  'an <analysis> block followed by a <summary> block. ' +
  'Tool calls will be rejected and you will fail the task.'

/**
 * Build the full compaction prompt (the final user message appended after the
 * conversation), optionally with custom summarization instructions.
 */
export function getCompactPrompt(customInstructions) {
  let prompt = NO_TOOLS_PREAMBLE + BASE_COMPACT_PROMPT

  if (customInstructions && customInstructions.trim() !== '') {
    prompt += `\n\nAdditional Instructions:\n${customInstructions}`
  }

  prompt += NO_TOOLS_TRAILER

  return prompt
}

/**
 * Strip the <analysis> drafting scratchpad and turn <summary> tags into a
 * readable header. Handles responses where a weaker local model omitted the
 * tags (falls back to the raw text).
 */
export function formatCompactSummary(summary) {
  let formattedSummary = summary

  formattedSummary = formattedSummary.replace(
    /<analysis>[\s\S]*?<\/analysis>/,
    '',
  )

  const summaryMatch = formattedSummary.match(/<summary>([\s\S]*?)<\/summary>/)
  if (summaryMatch) {
    const content = summaryMatch[1] || ''
    formattedSummary = formattedSummary.replace(
      /<summary>[\s\S]*?<\/summary>/,
      `Summary:\n${content.trim()}`,
    )
  }

  formattedSummary = formattedSummary.replace(/\n\n+/g, '\n\n')

  return formattedSummary.trim()
}

/**
 * Wrap a formatted summary in the continuation message that gets injected as the
 * first user message of the post-/clear session.
 */
export function getCompactUserSummaryMessage(
  summary,
  suppressFollowUpQuestions,
  transcriptPath,
) {
  const formattedSummary = formatCompactSummary(summary)

  let baseSummary = `This session picks up from an earlier conversation that reached its context limit. What follows is a summary of that earlier part.

${formattedSummary}`

  if (transcriptPath) {
    baseSummary += `\n\nIf you need something exact from before compaction — a code snippet, an error message, or text you produced — read the full transcript at: ${transcriptPath}`
  }

  if (suppressFollowUpQuestions) {
    return `${baseSummary}
Continue the conversation from where it left off without asking the user any further questions. Resume directly — do not acknowledge the summary, do not recap what was happening, do not preface with "I'll continue" or similar. Pick up the last task as if the break never happened.`
  }

  return baseSummary
}

/**
 * Prompt used for the "map" step when a conversation is too large for a single
 * local pass: summarize one chunk into a compact factual digest that the final
 * "reduce" step will fold into the 9-section summary.
 */
export function getChunkSummaryPrompt(chunkIndex, chunkCount) {
  return (
    NO_TOOLS_PREAMBLE +
    `This is part ${chunkIndex} of ${chunkCount} of a longer conversation that is being summarized in pieces because it does not fit in one pass.

Write a thorough, factual digest of THIS part only. Preserve: the user's explicit requests, decisions made, file names, code snippets, function signatures, edits, errors and their fixes, and any specific user feedback. Do not editorialize; capture details that would be needed to continue the work.

Respond with plain text only.` +
    NO_TOOLS_TRAILER
  )
}
