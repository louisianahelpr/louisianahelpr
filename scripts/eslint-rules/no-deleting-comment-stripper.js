/**
 * Ban the hand-rolled comment stripper that DELETES the code it is about to
 * search.
 *
 * ── The bug, and why a guard alone was not enough ───────────────────────────
 * Dozens of tests in this repo scan source text and must first hide comments,
 * or a helper NAMED in prose reads as a call. The obvious way is:
 *
 *     src.replace(&#47;\&#47;\*[\s\S]*?\*\&#47;/g, "").replace(/^\s*\&#47;\&#47;.*$/gm, "")
 *
 * It is wrong, and quietly. A `/` followed by `*` inside a URL, a regex
 * literal or a string opens a "comment" that runs to the next `*` + `/`
 * ANYWHERE later in the file. Measured repo-wide by
 * src/test/guardsDoNotDeleteSource.test.ts: it empties 293 of 1,053 source
 * files by more than 60%. A guard that scans an emptied file finds nothing and
 * reports GREEN — the exact failure mode these guards exist to prevent, inside
 * the guards themselves.
 *
 * `src/test/helpers/blankNonCode.ts` is the correct implementation: it is
 * string-aware, and it BLANKS rather than deletes, so offsets and line numbers
 * survive. `blankComments` keeps string bodies (for scans that need a class
 * name or a route); `blankNonCode` blanks those too.
 *
 * ── Why this rule exists on top of that test ────────────────────────────────
 * The test already existed and it worked — it caught four new guards written
 * on 2026-09-22. But it only runs in a REPO-WIDE `vitest run`, so it caught
 * them after they had been committed and pushed. Everything in this repo's
 * history says a guard that fires late gets worked around rather than heeded.
 *
 * eslint runs on every staged file through lint-staged, so this refuses the
 * pattern at the commit boundary and in the editor, which is where a mistake
 * costs nothing to fix. Same defect, same message, moved earlier.
 */

/**
 * Files that already carried this pattern when the rule landed (2026-09-22).
 *
 * Grandfathered, not forgiven — same shape as button-height-legacy.json. The
 * vitest guard `guardsDoNotDeleteSource.test.ts` only ever policed NEW guards,
 * so 29 older files were never asked to change and failing them all now would
 * turn one real lesson into a repo-wide stop-the-line.
 *
 * THE LIST MAY ONLY SHRINK. It is checked by
 * src/test/deletingStripperLegacyOnlyShrinks.test.ts, which fails on an entry
 * that no longer needs to be here — so a file fixed in passing cannot leave a
 * stale excuse behind, and nothing can be added to it to silence a new
 * violation.
 */
import LEGACY from "./deleting-comment-stripper-legacy.json" with { type: "json" };

const legacy = new Set(LEGACY);

export default {
  meta: {
    type: "problem",
    docs: {
      description:
        "use blankComments/blankNonCode instead of a regex that deletes comments — a `/*` inside a URL or regex swallows the rest of the file",
    },
    schema: [],
    messages: {
      deleting:
        "This regex deletes the code it is about to search: a `/` + `*` inside a URL, string or regex literal opens a comment that runs to the next `*/` anywhere later, emptying 293 of 1,053 files repo-wide by >60% — and a guard that scans an emptied file reports GREEN. Import { blankComments } (keeps string bodies) or { blankNonCode } from src/test/helpers/blankNonCode instead.",
    },
  },
  create(context) {
    // `context.filename` (flat config, eslint 9); `getFilename()` was removed.
    const rel = (context.filename ?? context.getFilename?.() ?? "")
      .replace(process.cwd() + "/", "")
      .replaceAll("\\", "/");
    if (legacy.has(rel)) return {};
    return {
      Literal(node) {
        if (!node.regex) return;
        const src = `/${node.regex.pattern}/${node.regex.flags}`;
        // The block-comment form is the dangerous one: it is the pattern that
        // spans arbitrary text. Match it structurally rather than by exact
        // spelling so a reordered or re-flagged copy is caught too.
        const spansAnything = /\[\\s\\S\]\*\??/.test(node.regex.pattern);
        const opensComment = node.regex.pattern.includes("\\/\\*");
        const closesComment = node.regex.pattern.includes("\\*\\/");
        if (spansAnything && opensComment && closesComment) {
          context.report({ node, messageId: "deleting" });
        }
      },
    };
  },
};
