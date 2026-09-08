// Inline-HTML stripping for the export renderer.
//
// The library ships this as `stripHtmlFormattingTags` from
// `react-super-mermaid/orid` starting with 0.28.1, but npm still serves 0.28.0
// — importing it from there breaks `tsc` on a fresh clone. Keeping a local copy
// means the extension builds against the published package with no extra setup;
// switch the import back once 0.28.1 is on npm.

// Formatting tags mermaid only understands while htmlLabels is on, with their
// attributes (quoted runs matched first, so a '>' inside style="…" is kept out
// of the way). `<br>` is deliberately not in the list: with htmlLabels off
// mermaid still turns it into a line break, so it has to survive.
const TAG_RE =
  /<\/?(?:b|strong|i|em|u|s|strike|del|ins|mark|small|sub|sup|span|font|code)\b(?:\s+(?:"[^"]*"|'[^']*'|[^>])*)?\/?>/gi;

/**
 * Remove inline HTML formatting tags from a mermaid source, keeping the text
 * they wrap (and any `<br>`) intact. Used on the export path, which renders
 * with htmlLabels off and would otherwise draw `<b>` into the image verbatim.
 */
export function stripHtmlFormattingTags(source: string): string {
  return source.replace(TAG_RE, '');
}
