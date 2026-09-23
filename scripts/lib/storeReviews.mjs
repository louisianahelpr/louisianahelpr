/**
 * App Store reviews that report a problem reach the ops alert ledger
 * (docs/OPEN.md Q289) — pure logic, no I/O. scripts/check-store-reviews.mjs
 * fetches and records; tested in src/test/storeReviews.test.ts.
 *
 * WHICH REVIEWS. Every App Store customer review rated REVIEW_MAX_RATING (3)
 * stars or lower becomes a `user-report` ledger item (source
 * app-store-review, verify manual: the owner closes it after reading or
 * answering it in App Store Connect). A 4-5 star review is praise, not a
 * report. A review cannot be told apart as "a bug report" from its text
 * reliably, so the rating is the rule.
 *
 * ONCE PER REVIEW. The ledger keeps the NEWEST occurrence's sample_ref per
 * item, and reviews are recorded oldest first, so the latest review_created
 * across this source's items (and anything still queued in
 * ops_alert_pending) is the cursor: a run records only reviews created after
 * it. With no cursor yet, it looks back LOOKBACK_DAYS.
 *
 * PRIVACY. The repo is public and Actions logs are public: review text and
 * nicknames go into the ledger row only (sample), never to stdout. The
 * listing everyone prints (OPEN_ITEMS_SQL) already redacts user-report titles.
 */

export const REVIEW_MAX_RATING = 3;
export const LOOKBACK_DAYS = 14;
export const SOURCE = "app-store-review";
export const BUNDLE_ID_DEFAULT = "com.Helpr";

/** Read the cursor: newest review_created this source has recorded, or NULL. One row always. */
export const CURSOR_SQL = `
SELECT max(t)::text AS cursor FROM (
  SELECT (sample_ref->>'review_created')::timestamptz AS t FROM public.ops_alert_ledger WHERE source = '${SOURCE}'
  UNION ALL
  SELECT (sample_ref->>'review_created')::timestamptz FROM public.ops_alert_pending WHERE source = '${SOURCE}'
) s`;

/** ASC customerReviews resource -> plain review. */
export function toReview(r) {
  const a = r?.attributes ?? {};
  return {
    id: String(r?.id ?? ""),
    rating: Number(a.rating),
    title: String(a.title ?? ""),
    body: String(a.body ?? ""),
    nickname: String(a.reviewerNickname ?? ""),
    territory: String(a.territory ?? ""),
    created: String(a.createdDate ?? ""),
  };
}

/** Where a run starts: the cursor, else now - LOOKBACK_DAYS. */
export function sinceFrom(cursor, now = new Date()) {
  const c = cursor ? Date.parse(cursor) : NaN;
  return Number.isFinite(c) ? new Date(c) : new Date(now.getTime() - LOOKBACK_DAYS * 86_400_000);
}

/**
 * The reviews to record, oldest first: rated <= REVIEW_MAX_RATING and created
 * strictly after `since`. A review with no readable rating or date is
 * returned in `unreadable`, never silently dropped.
 */
export function reportable(reviews, since) {
  const out = [];
  const unreadable = [];
  for (const r of reviews) {
    const t = Date.parse(r.created);
    if (!r.id || !Number.isFinite(r.rating) || r.rating < 1 || r.rating > 5 || !Number.isFinite(t)) {
      unreadable.push(r);
      continue;
    }
    if (t <= since.getTime()) continue;
    if (r.rating <= REVIEW_MAX_RATING) out.push(r);
  }
  out.sort((a, b) => Date.parse(a.created) - Date.parse(b.created));
  return { reviews: out, unreadable };
}

/** The ledger item for one review (recordOpsAlert's argument). */
export function ledgerItem(r, appId) {
  const band = r.rating <= 2 ? "low rating" : "mixed rating";
  const title = (r.title.trim() || r.body.trim().slice(0, 60) || "(no title)").slice(0, 120);
  return {
    sourceKind: "user-report",
    source: SOURCE,
    title: `App Store review, ${band}: ${title}`,
    severity: r.rating <= 2 ? "error" : "warning",
    sample: `${r.rating}/5 stars, ${r.territory || "unknown territory"}, by ${r.nickname || "anonymous"}\n${r.title}\n\n${r.body}`.slice(0, 2000),
    sampleRef: {
      review_id: r.id,
      rating: r.rating,
      territory: r.territory,
      review_created: r.created,
      link: appId ? `https://appstoreconnect.apple.com/apps/${appId}/distribution/activity/ios/ratingsResponses` : null,
    },
    verifyKind: "manual",
    seenAt: r.created,
  };
}
