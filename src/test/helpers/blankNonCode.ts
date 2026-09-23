/* eslint-disable no-irregular-whitespace --
 * The U+200B ZERO WIDTH SPACEs below are load-bearing, not stray paste debris.
 * This file documents comment syntax, so its own doc comment has to SHOW a
 * nested block-comment terminator. Writing that terminator literally would end
 * the comment it appears in and break the file, so a zero-width space sits
 * between the asterisk and the slash. Deleting them to satisfy the rule would
 * not "clean up whitespace" — it would truncate this file at the first example.
 */
/**
 * The one correct way to hide comments and string literals from a source scan.
 *
 * ── Why this file exists ────────────────────────────────────────────────────
 * Dozens of guards in this repo inspect source text: "does this component call
 * that helper", "does this query carry a filter", "is this class name applied".
 * All of them must first ignore comments and string bodies, or a helper named
 * in prose reads as a call. Nearly all of them did it the obvious way:
 *
 *     src.replace(BLOCK_COMMENT_RE, " ").replace(LINE_COMMENT_RE, " ")
 *
 * ...where BLOCK_COMMENT_RE is the familiar non-greedy slash-star-to-star-slash
 * pattern. (Spelled out in words here on purpose: writing that regex inside
 * this very comment ends the comment early — the same class of bug, one level
 * up.)
 *
 * A regex has no idea whether it is inside a string. The `/*` in a URL, a regex
 * literal, or a `"https://…"` opens a comment that runs to the next `*` + `/`
 * ANYWHERE later in the file and deletes everything between. The `//` in
 * `https://` does the same to the rest of its line.
 *
 * Measured across the repo on 2026-09-21, counting REAL CODE LOST rather than
 * bytes removed (this repo writes long header comments, so bytes-removed
 * flatters the naive version): **157 of 1,054 TS/TSX source files** lose code.
 * `supabase/functions/brand-asset/index.ts` loses 98% of its own code — 52,892
 * characters. A guard scanning a file it has silently emptied finds nothing and
 * reports green, which is indistinguishable from the code being correct.
 *
 * NOTE: this helper is JS/TS only. SQL needs its own scanner — `--` comments,
 * `''` escaping, and `$tag$…$tag$` bodies that must be recursed into rather
 * than treated as opaque strings.
 *
 * That is not hypothetical. `src/test/edge/sharedImports.test.ts` exists to
 * catch an edge function calling a `_shared` helper it never imported — the
 * `release-payout`/`postSlackOpsAlert` ReferenceError that reached main in a
 * money path. Its stripper destroyed 53 of 96 edge files, so deleting that
 * import from `arrival-confirm-reminder` left it green while the identical
 * mutation on `release-payout` failed it. It was guarding whichever files
 * happened to survive.
 *
 * ── The fix ─────────────────────────────────────────────────────────────────
 * One left-to-right scan. It knows whether it is inside a string before it
 * looks at a `/`, so it cannot be fooled by either direction.
 *
 * It BLANKS rather than deletes: every byte position, line number and column in
 * the result matches the input, so a match still points at the right place and
 * `split("\n")` line indexes stay valid. Quote characters are kept and only the
 * body is blanked, so `.from("tips")` becomes `.from("    ")` — if a scan needs
 * the string CONTENT (a table name, a route path), use `blankComments` instead,
 * which strips comments only and leaves strings whole.
 */

/** Comments AND string bodies blanked. Offsets and line count preserved. */
export function blankNonCode(src: string): string {
  return scan(src, true);
}

/**
 * Comments blanked, string bodies PRESERVED.
 *
 * For scans that need the text inside a literal — a table name in
 * `.from("tips")`, a route in `navigate("/browse")`. Still string-aware, so a
 * `//` inside a URL is not mistaken for a comment.
 */
export function blankComments(src: string): string {
  return scan(src, false);
}

function scan(src: string, blankStrings: boolean): string {
  const out = src.split("");
  const n = src.length;
  let i = 0;
  const blank = (from: number, to: number) => {
    for (let k = from; k < to && k < n; k++) if (out[k] !== "\n") out[k] = " ";
  };
  while (i < n) {
    const c = src[i];
    const d = src[i + 1];
    if (c === "/" && d === "/") {
      let j = i;
      while (j < n && src[j] !== "\n") j++;
      blank(i, j);
      i = j;
      continue;
    }
    if (c === "/" && d === "*") {
      let j = i + 2;
      while (j < n && !(src[j] === "*" && src[j + 1] === "/")) j++;
      blank(i, Math.min(j + 2, n));
      i = j + 2;
      continue;
    }
    if (c === "/" && regexCanStart(src, i)) {
      /*
       * A REGEX LITERAL IS NOT CODE EITHER (Q24).
       *
       * `/null \(reading 'use[A-Z]\w*'\)/i` (src/lib/chunkReload.ts) holds a
       * `'`; read as code, that quote opened a "string" which ran to the next
       * `'` in the file and swallowed the comments in between, so guards read
       * them as live code. A `/` where an expression can START is a regex, not
       * division. Its body is kept as-is (like a string with blankStrings off).
       */
      let j = i + 1;
      let inClass = false;
      while (j < n && src[j] !== "\n") {
        const ch = src[j];
        if (ch === "\\") { j += 2; continue; }
        if (ch === "[") inClass = true;
        else if (ch === "]") inClass = false;
        else if (ch === "/" && !inClass) break;
        j++;
      }
      if (j < n && src[j] === "/") {
        if (blankStrings) blank(i + 1, j /* regex body */);
        j++;
        while (j < n && /[a-z]/i.test(src[j])) j++;
        i = j;
        continue;
      }
      // No closing `/` on the line: not a regex after all; fall through.
    }
    if (c === '"' || c === "'" || c === "`") {
      /*
       * AN APOSTROPHE IN PROSE IS NOT A STRING QUOTE.
       *
       * .tsx files carry JSX TEXT, which is not JavaScript: `know who they're
       * hiring` sits in the middle of an element. Treating that `'` as a quote
       * made the scan skip forward to the next apostrophe anywhere in the file
       * and swallow everything between — including, in IdentityHeader.tsx, a
       * whole `{/* … *​/}` comment, which then read as live code. That is the
       * same failure as the regex version, arrived at from the other side:
       * the regex was fooled by strings, this was fooled by prose.
       *
       * A `'` with a letter on BOTH sides is inside a word. No valid JS opens a
       * string immediately after an identifier character, so this cannot hide a
       * real literal — `don't`, `they're`, `Helpr's` are text and nothing else.
       */
      if (c === "'" && /[A-Za-z]/.test(src[i - 1] ?? "") && /[A-Za-z]/.test(src[i + 1] ?? "")) {
        i++;
        continue;
      }
      let j = i + 1;
      while (j < n && src[j] !== c) {
        if (src[j] === "\\") j++;
        j++;
      }
      // Quotes themselves survive either way, so `.from("x")` keeps its shape.
      if (blankStrings) blank(i + 1, j);
      i = j + 1;
      continue;
    }
    i++;
  }
  return out.join("");
}

/**
 * Whether a `/` at `i` can open a regex literal: the previous significant
 * token must be one after which an expression starts (an operator, an opening
 * bracket, a comma, or a keyword like `return`), not an identifier, number or
 * closing bracket (which make it division).
 */
function regexCanStart(src: string, i: number): boolean {
  let k = i - 1;
  while (k >= 0 && /[ \t\r\n]/.test(src[k])) k--;
  if (k < 0) return true;
  const p = src[k];
  if ("([{,;:=!&|?+-*%<>~^".includes(p)) return true;
  if (/[A-Za-z_$]/.test(p)) {
    let s = k;
    while (s >= 0 && /[A-Za-z_$]/.test(src[s])) s--;
    const word = src.slice(s + 1, k + 1);
    return ["return", "typeof", "case", "in", "of", "delete", "void", "throw", "new", "else", "do", "yield", "await"].includes(word);
  }
  return false;
}

/**
 * SQL comments blanked, string bodies preserved. The SQL twin of
 * `blankComments`.
 *
 * SQL needs its own scanner, not a `--` added to the JS one:
 *
 *   - Line comments are `--`, not `//`. A naive `/--[^\n]*!/g` deletes the rest
 *     of the line from any `--` inside a string literal.
 *   - String literals escape a quote by DOUBLING it (`'it''s'`), not with a
 *     backslash. A scanner that skips `\'` walks off the end of the literal and
 *     treats the following SQL as string.
 *   - Block comments NEST in Postgres: `/* a /* b *​/ c *​/` is one comment. A
 *     non-greedy regex stops at the first inner terminator and leaves ` c *​/`
 *     behind as if it were code.
 *   - `$tag$ … $tag$` dollar-quoting wraps every function body in this repo,
 *     and a body is SQL, not opaque text: the `--` comments inside it ARE
 *     comments and a guard wants them gone. So the scanner RECURSES into the
 *     body rather than skipping it — which is exactly the decision that made a
 *     first, naive measurement of migration damage meaningless.
 *
 * Why it matters here: migrations are where the authz and money rules live
 * (`lock_anonymized_at`, `redact_public_payout_names`,
 * `lock_job_row_on_apply_and_confirm`), and a guard that scans a migration it
 * has silently emptied reports green.
 */
export function blankSqlComments(src: string): string {
  const out = src.split("");
  const n = src.length;
  const blank = (from: number, to: number) => {
    for (let k = from; k < to && k < n; k++) if (out[k] !== "\n") out[k] = " ";
  };
  let i = 0;
  while (i < n) {
    const c = src[i];
    const d = src[i + 1];
    if (c === "-" && d === "-") {
      let j = i;
      while (j < n && src[j] !== "\n") j++;
      blank(i, j);
      i = j;
      continue;
    }
    if (c === "/" && d === "*") {
      let depth = 1;
      let j = i + 2;
      while (j < n && depth > 0) {
        if (src[j] === "/" && src[j + 1] === "*") { depth++; j += 2; continue; }
        if (src[j] === "*" && src[j + 1] === "/") { depth--; j += 2; continue; }
        j++;
      }
      blank(i, Math.min(j, n));
      i = j;
      continue;
    }
    if (c === "$") {
      const tag = /^\$[A-Za-z_][\w]*\$|^\$\$/.exec(src.slice(i, i + 64))?.[0];
      if (tag) {
        const end = src.indexOf(tag, i + tag.length);
        const bodyEnd = end < 0 ? n : end;
        // The body is SQL: scan it too, so comments inside a function body are
        // blanked like any other. The tags themselves stay.
        const inner = blankSqlComments(src.slice(i + tag.length, bodyEnd));
        for (let k = 0; k < inner.length; k++) out[i + tag.length + k] = inner[k];
        i = end < 0 ? n : end + tag.length;
        continue;
      }
    }
    if (c === "'") {
      let j = i + 1;
      while (j < n) {
        if (src[j] === "'") {
          if (src[j + 1] === "'") { j += 2; continue; } // '' escape
          break;
        }
        j++;
      }
      i = j + 1;
      continue;
    }
    i++;
  }
  return out.join("");
}
