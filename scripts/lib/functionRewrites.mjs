/**
 * In-place function rewrites: the ONE parser for migrations that change a
 * function by reading pg_get_functiondef(), running regexp_replace over it and
 * EXECUTE-ing the result (20260831232514, 20260901021929, 20260925143327).
 *
 * Such a migration contains no CREATE FUNCTION text, so anything that replays
 * the migrations by their CREATE statements alone believes the pre-rewrite body
 * is what runs. Two readers need the post-rewrite body, and they used to hold
 * two different models of it:
 *   - src/test/helpers/effectiveFunctionDefs.ts (the repo-side guards) parsed
 *     the rewrite tuples and applied them;
 *   - scripts/audit/function-body-drift.mjs (the nightly check that prod runs
 *     the body the repo says) did not, and only tolerated differences in
 *     notification-link literals.
 * On 2026-09-25 20260925143327 rewrote notification COPY in 11 functions the
 * same way, prod applied it exactly as written, and the nightly check went red
 * on all 11 as "patched by dynamic SQL or by hand" (issue #1802). Both readers
 * now parse and apply the tuples here.
 *
 * The tuple shape, inside a DO block that calls pg_get_functiondef and
 * regexp_replace:
 *   (ord, 'fn', $p$pattern$p$, $q$replacement$q$, 'flags')
 * Postgres runs them in `ord` order, over every overload of public.fn; a
 * pattern that does not match changes nothing.
 */

export const REWRITE_TUPLE =
  /\(\s*(\d+)\s*,\s*'(\w+)'\s*,\s*\$p\$([\s\S]*?)\$p\$\s*,\s*\$q\$([\s\S]*?)\$q\$\s*,\s*'(\w*)'\s*\)/g;

/**
 * Rewrite tuples of one migration, sorted by `ord`. `code` is the migration
 * with comments BLANKED (same length, same offsets); `sql` is the raw text.
 * Tuples are located on `code` (a commented-out tuple changes nothing) and read
 * from `sql` at the same offsets. `index` is where the tuple sits, so a caller
 * can order the rewrites against CREATE statements in the same file.
 * @returns {{file: string, ord: number, fn: string, pattern: string, replacement: string, flags: string, index: number}[]}
 */
export function parseRewriteTuples(sql, code = sql, file = "") {
  if (!/pg_get_functiondef\s*\(/i.test(code) || !/regexp_replace\s*\(/i.test(code)) return [];
  const out = [];
  for (const m of code.matchAll(REWRITE_TUPLE)) {
    const raw = sql.slice(m.index, m.index + m[0].length);
    const r = new RegExp(REWRITE_TUPLE.source).exec(raw);
    if (!r) continue;
    out.push({ file, ord: Number(r[1]), fn: r[2].toLowerCase(), pattern: r[3], replacement: r[4], flags: r[5], index: m.index });
  }
  return out.sort((a, b) => a.ord - b.ord);
}

/** Postgres regexp_replace, in JS. ARE `.` spans newlines unless flag `n`. */
export function pgRegexpReplace(src, pattern, replacement, flags) {
  const jsFlags = (flags.includes("g") ? "g" : "") + (flags.includes("n") ? "" : "s") + (flags.includes("i") ? "i" : "");
  const rep = replacement
    .replace(/\$/g, "$$$$")
    .replace(/\\&/g, "$$&")
    .replace(/\\(\d)/g, "$$$1");
  return src.replace(new RegExp(pattern, jsFlags), rep);
}
