/**
 * Closing references in commit messages (docs/OPEN.md Q1184).
 *
 * GitHub closes an issue when a commit that reaches the default branch says
 * `close(s|d)` / `fix(es|ed)` / `resolve(s|d)` followed by a reference to it.
 * On 2026-10-03 584eef85c's body closed nightly-red issue #2200 before its
 * workflow had gone green. Nothing was ticked falsely (open-done-when and the
 * ledger refuse a hand-closed alert), but the alert was gone early.
 *
 * Pure: no git, no gh. scripts/check-closing-keywords.mjs feeds it the
 * messages of a landing and asks gh which of the referenced issues carry the
 * nightly-red label; scripts/land.sh runs that before it pushes.
 * Guard: src/test/closingKeywordNightlyRed.test.ts.
 */

/** The label every nightly workflow's alert issue carries. */
export const NIGHTLY_RED = "nightly-red";

const KEYWORD = "(?:close[sd]?|fix(?:e[sd])?|resolve[sd]?)";
// keyword, then ":" or blanks, then ONE reference: issue URL, owner/repo#N, GH-N or #N.
const CLOSING = new RegExp(
  `(?<![\\w-])${KEYWORD}(?![\\w-])(?::[ \\t]*|[ \\t]+)` +
    "(?:" +
    "https?://(?:www\\.)?github\\.com/([\\w.-]+/[\\w.-]+)/issues/(\\d+)" +
    "|([\\w.-]+/[\\w.-]+)#(\\d+)" +
    "|(?:#|GH-)(\\d+)" +
    ")(?![\\w-])",
  "gi",
);

/**
 * Every issue a message would close, once each, in order of appearance.
 * `repo` is "owner/name" for a cross-repo or URL reference, null for a bare
 * `#N` / `GH-N` (the repository the commit lands in).
 *
 * @param {string} message
 * @returns {{ repo: string | null, number: number }[]}
 */
export function closingReferences(message) {
  const seen = new Set();
  const out = [];
  for (const m of String(message ?? "").matchAll(CLOSING)) {
    const repo = (m[1] ?? m[3] ?? null)?.toLowerCase() ?? null;
    const number = Number(m[2] ?? m[4] ?? m[5]);
    const key = `${repo ?? ""}#${number}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ repo, number });
  }
  return out;
}

/**
 * Judge a landing. `labelsOf(ref)` returns the issue's label names, or THROWS
 * when it cannot answer (gh missing, signed out, offline, not an issue): an
 * unanswerable reference is refused, never waved through (fail closed).
 *
 * @param {{ sha: string, message: string }[]} commits
 * @param {(ref: { repo: string | null, number: number }) => string[]} labelsOf
 * @returns {{
 *   blocked: { sha: string, ref: { repo: string | null, number: number } }[],
 *   unanswered: { sha: string, ref: { repo: string | null, number: number }, why: string }[],
 * }}
 */
export function judgeClosers(commits, labelsOf) {
  const blocked = [];
  const unanswered = [];
  const answers = new Map();
  for (const { sha, message } of commits) {
    for (const ref of closingReferences(message)) {
      const key = `${ref.repo ?? ""}#${ref.number}`;
      if (!answers.has(key)) {
        try {
          const labels = labelsOf(ref);
          if (!Array.isArray(labels)) throw new Error("labels were not a list");
          answers.set(key, { labels });
        } catch (e) {
          answers.set(key, { why: e instanceof Error ? e.message : String(e) });
        }
      }
      const a = answers.get(key);
      if (a.why !== undefined) unanswered.push({ sha, ref, why: a.why });
      else if (a.labels.includes(NIGHTLY_RED)) blocked.push({ sha, ref });
    }
  }
  return { blocked, unanswered };
}

/** "#12" or "owner/repo#12". */
export const refText = (ref) => `${ref.repo ?? ""}#${ref.number}`;
