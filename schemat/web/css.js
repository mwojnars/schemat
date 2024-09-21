
/**********************************************************************************************************************
 **
 **  CSS UTILITIES
 **
 */

export function compact_css(css) {
    /* Remove comments and merge whitespace (including newlines) inside CSS code. */

    let compacted = css.replace(/\/\*[\s\S]*?\*\//g, '')                        // remove comments

    compacted = compacted.split(/(['"])(?:(?=(\\?))\2.)*?\1/)                           // avoid compacting whitespace inside quotes
        .map((chunk, index) => index % 2 === 0 ? chunk.replace(/\s+/g, ' ') : chunk     // compact only outside quotes
    ).join('')

    compacted = compacted.replace(/\{\s+/g, '{').replace(/\s+\}/g, '}')         // remove spaces after "{" and before "}"

    return compacted.trim()
}

