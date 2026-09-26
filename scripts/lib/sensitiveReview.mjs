/**
 * Money / authz / data-model commits must carry a RECORDED review (docs/OPEN.md Q9).
 *
 * CLAUDE.md requires a review-only pass (lh-authz-rls, lh-money-escrow,
 * lh-silent-failure, /code-review, /security-review) before committing such a
 * diff. Agents skipped it; that is how the javascript: href reached main.
 * Measured 2026-09-26: of 145 non-merge commits on main touching
 * supabase/migrations since 2026-09-19, 110 mention no review at all.
 *
 * A review is recorded either
 *   - in the commit itself, as a trailer:  Sensitive-Review: lh-authz-rls: clean
 *     (or `Sensitive-Review: not-needed: <reason>` for e.g. a comment-only edit), or
 *   - after the fact, as a line in docs/reviews/sensitive-reviews.jsonl
 *     ({"sha", "reviewer", "verdict", "date"}), via
 *     `node scripts/check-sensitive-review.mjs record <sha> <reviewer> <verdict>`.
 *
 * It REPORTS; it never blocks a push. Pure logic here, I/O in
 * scripts/check-sensitive-review.mjs, guard src/test/sensitiveReview.test.ts.
 */

/** Commits before this landed are history, measured once above, not a backlog. */
// The instant the gate landed on main (39451a470, 2026-09-26T06:01:59Z), in UTC. A bare
// date means 00:00Z that day. Earlier commits predate the rule (their reviews: Q718).
export const START_DATE = "2026-09-26T06:01:59Z";
/** "YYYY-MM-DD" or an ISO instant -> the UTC instant the window opens. */
export const windowStart = (since) => (since.includes("T") ? since : `${since}T00:00:00Z`);

export const REVIEWERS = ["lh-authz-rls", "lh-money-escrow", "lh-silent-failure", "code-review", "security-review", "owner"];

const SRC_SENSITIVE =
  /(escrow|payment|payout|refund|dispute|stripe|money|charge|wallet|credit|gift-?card|subscription|checkout|tip(s|ping)?\b|auto-?tip|fees?\b|Fees?[A-Z.]|cancellationFee|auth|rls|admin|ban(ned)?\b|Ban|credential|verification|identity|supabaseResult|mutationResult)/i;

/** Is this changed path a money / authz / data-model surface? */
export function isSensitive(path) {
  if (/\.(test|spec)\.[cm]?[jt]sx?$/.test(path) || /\/__tests__\//.test(path)) return false;
  if (/^supabase\/migrations\/.+\.sql$/.test(path)) return true;
  if (/^supabase\/functions\//.test(path)) return true;
  if (/^src\/.+\.(ts|tsx)$/.test(path) && !/^src\/test\//.test(path)) return SRC_SENSITIVE.test(path);
  return false;
}

/** The review a commit message records, or null. Last matching trailer wins. */
export function trailerReview(message) {
  let found = null;
  for (const m of String(message).matchAll(/^Sensitive-Review:\s*([\w-]+)\s*:\s*(\S.*)$/gim)) {
    const reviewer = m[1].toLowerCase();
    if (reviewer === "not-needed" || REVIEWERS.includes(reviewer)) found = { reviewer, verdict: m[2].trim(), via: "trailer" };
  }
  return found;
}

/** sha -> review from docs/reviews/sensitive-reviews.jsonl (bad lines are reported, not dropped). */
export function parseLog(text) {
  const bySha = new Map();
  const errors = [];
  String(text).split("\n").forEach((line, i) => {
    if (!line.trim()) return;
    try {
      const e = JSON.parse(line);
      if (!/^[0-9a-f]{7,40}$/.test(e.sha ?? "") || !REVIEWERS.includes(e.reviewer) || !String(e.verdict ?? "").trim()) throw new Error("needs sha, a known reviewer and a verdict");
      bySha.set(e.sha, { reviewer: e.reviewer, verdict: e.verdict, via: "log" });
    } catch (err) {
      errors.push(`line ${i + 1}: ${err.message}`);
    }
  });
  return { bySha, errors };
}

const logLookup = (bySha, sha) => {
  for (const [k, v] of bySha) if (sha.startsWith(k)) return v;
  return null;
};

/**
 * commits: [{ sha, date (ISO), message, files: [path] }] — non-merge commits.
 * Returns the sensitive ones, each with its review or null.
 */
export function audit(commits, logBySha, { since = START_DATE } = {}) {
  const rows = [];
  for (const c of commits) {
    // Compared as instants, never as the committer's local date string: the same commit must
    // land on the same side of the window on every machine (Q717: 0 missing on the Mac, 2 in CI).
    if (Date.parse(c.date) < Date.parse(windowStart(since))) continue;
    const sensitive = c.files.filter(isSensitive);
    if (!sensitive.length) continue;
    rows.push({ ...c, sensitive, review: trailerReview(c.message) ?? logLookup(logBySha, c.sha) });
  }
  return { rows, missing: rows.filter((r) => !r.review) };
}
