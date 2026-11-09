/**
 * Drop the HTML comments from the BUILT index.html (Q2705, Builder 4, 2026-11-09).
 *
 * index.html carries its own history as comments (why each preload, shell and inline script is there). They are the
 * right place for that history in the source, but every visitor downloaded them: on the build of main 873309be70
 * the 26 comments were 24,227 B raw / 8,760 B brotli of a 30,661 B brotli page (29%), and on Slow 4G every byte of
 * the HTML is ahead of the first frame, the font preloads and the entry script.
 *
 * Only comments OUTSIDE <script> and <style> are removed. Inline scripts are allowed by their exact sha256 (the CSP
 * in vercel.json and index.html's meta, checked by scripts/check-csp-inline-scripts.mjs), and the inline shell CSS
 * has its own byte ceiling, so neither is touched: their text, JS and CSS comments and blank lines included, comes
 * out byte-identical. Markup lines a removed comment leaves holding only whitespace are dropped.
 *
 * Guard: src/test/builtHtmlHasNoComments.test.ts.
 */

// One pass, earliest match first: a comment that MENTIONS "<script>" (several do) is a comment, not a script start,
// and a "<!--" inside a script's text is script text.
const TOKEN = /<!--[\s\S]*?-->|<(script|style)\b[^>]*>[\s\S]*?<\/\1\s*>/gi;

/** The markup with every `<!-- ... -->` outside <script>/<style> removed; script and style blocks byte-identical. */
export function stripHtmlComments(html) {
  let out = "";
  let markup = "";
  let last = 0;
  for (const m of html.matchAll(TOKEN)) {
    markup += html.slice(last, m.index);
    if (!m[0].startsWith("<!--")) {
      out += tidy(markup) + m[0];
      markup = "";
    }
    last = m.index + m[0].length;
  }
  return out + tidy(markup + html.slice(last));
}

/** Whitespace-only lines in markup carry no meaning; a removed comment leaves them behind. */
function tidy(markup) {
  return markup.replace(/\n(?:[ \t]*\n)+/g, "\n");
}
