// Single source of the user-facing brand prefix.
//
// Every line Parobek prints to the screen — command stdout AND hook
// systemMessage/additionalContext — must be attributable to this plugin, because
// a user may run many plugins and a bare message like "invalid config" does not
// say WHICH plugin emitted it.

export const BRAND = 'Parobek'
export const TAG = `[${BRAND}]`

/** Prefix a single line with the brand tag (for systemMessage / inline strings). */
export const tag = (msg) => `${TAG} ${msg}`

/** Print a brand-prefixed line to stdout (command output). */
export const say = (msg) => console.log(tag(msg))
