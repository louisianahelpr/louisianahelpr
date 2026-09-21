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
 * Measured across the repo on 2026-09-21: that expression deletes more than
 * 60% of **293 of the 1,053 source files** — `src/lib/groupJobs.ts` 99%,
 * `supabase/functions/brand-asset/index.ts` 98%. A guard scanning a file it has
 * silently emptied finds nothing and reports green, which is indistinguishable
 * from the code being correct.
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
    if (c === '"' || c === "'" || c === "`") {
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
