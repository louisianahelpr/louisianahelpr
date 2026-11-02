/**
 * Q2350: a "contains" value for an `ilike` filter inside a PostgREST `.or()`
 * string, built from text a person typed.
 *
 * Measured on prod 2026-11-02 (read-only counts, signed out): with the old
 * backslash escape (`%a\,b%`), a search holding a comma or ")" made
 * open_jobs_browse answer HTTP 400, because PostgREST splits the `.or()` list
 * on them before it reads a backslash. Browse's count is a HEAD request, so
 * the 400 came back with no body and Sentry showed "No error message"
 * (JAVASCRIPT-41). PostgREST's documented way to carry reserved characters is a
 * double-quoted value; every quoted form tried answered 200.
 *
 * Two layers of escaping, in this order:
 *  1. LIKE: `\` and `%` are matched literally (a typed "%" never widens the
 *     match, as before).
 *  2. PostgREST: inside the double quotes, `\` and `"` are backslash-escaped.
 */
export function ilikeContains(raw: string): string {
  const like = raw.replace(/[\\%]/g, (ch) => `\\${ch}`);
  const quoted = like.replace(/[\\"]/g, (ch) => `\\${ch}`);
  return `"%${quoted}%"`;
}
