// Degenerate-output detection for local-model responses.
//
// Small local models, at low temperature with very long inputs, sometimes fall
// into a repetition loop: they emit the same line (or short fragment) thousands
// of times. Such a response passes the "non-empty" check yet is useless — and if
// it were saved as a pending summary it would poison the next session after
// /clear. This module flags those responses so /local-compact can retry once and,
// failing that, refuse to persist the garbage.
//
// Heuristics are deliberately conservative so a legitimate, list-heavy summary
// (mostly unique lines) never trips them; pure functions, no dependencies.

/**
 * Whether `text` looks like a degenerate (looping/low-diversity) generation.
 *
 *   - minLines:              below this, short text is harmless → never flagged.
 *   - maxConsecutiveRepeats: same non-trivial line repeated back-to-back more
 *                            than this many times → degenerate (the exact failure
 *                            mode observed).
 *   - maxDuplicateFraction:  fraction of duplicate lines above which the output
 *                            is too repetitive to be a real summary.
 */
export function looksDegenerate(
  text,
  { minLines = 12, maxConsecutiveRepeats = 8, maxDuplicateFraction = 0.6 } = {},
) {
  if (!text) return false
  const lines = text
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
  if (lines.length < minLines) return false

  // Back-to-back repetition of the same (non-trivial) line.
  let run = 1
  for (let i = 1; i < lines.length; i++) {
    if (lines[i].length >= 4 && lines[i] === lines[i - 1]) {
      run++
      if (run > maxConsecutiveRepeats) return true
    } else {
      run = 1
    }
  }

  // Overall low diversity (lots of duplicate lines, even if not consecutive).
  const unique = new Set(lines).size
  const duplicateFraction = 1 - unique / lines.length
  return duplicateFraction > maxDuplicateFraction
}
