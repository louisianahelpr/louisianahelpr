#!/usr/bin/env node
/**
 * App Store reviews that report a problem reach the ops alert ledger
 * (docs/OPEN.md Q289). Daily, from .github/workflows/app-store-reviews.yml.
 *
 * Reads the newest customer reviews of the iOS app from the App Store Connect
 * API (GET /v1/apps/{id}/customerReviews, the team API key CI already holds for
 * ios-beta / expiry-monitor) and records every review rated 3 stars or fewer as
 * a `user-report` ledger item, source `app-store-review`, verify `manual` (no
 * SQL can tell whether a store review was answered; a person closes it after
 * reading and answering it in App Store Connect).
 *
 *   - ONE item per star rating ("app store review rated two stars"), its count
 *     = how many such reviews arrived; sample = the newest review's title and
 *     body, sample_ref = its review id, territory and a link to the ratings
 *     page. The title never carries review text: the fingerprint must not be
 *     mintable by whoever writes a review, and the repo is PUBLIC (Actions logs
 *     print titles; OPEN_ITEMS_SQL redacts user-report titles anyway).
 *   - Idempotent: a review is recorded only when it is NEWER than its item's
 *     last_seen, with seen_at = the review's own createdDate, so re-runs and
 *     overlapping windows never double-count.
 *   - Fails CLOSED: missing credentials, an API error, or a ledger write that
 *     did not land exits non-zero (the notify job files nightly-red). Google
 *     Play has no ingester yet: no Play Console credential exists in CI (Q289).
 *
 * This script never prints review text.
 */
import { pathToFileURL } from "node:url";
import { lit, sql } from "./lib/opsAlertLedger.mjs";

export const APP_APPLE_ID = "6754470134"; // fastlane/ios_app_metadata.yml identity.apple_id
export const SOURCE = "app-store-review";
const WORDS = ["zero", "one", "two", "three", "four", "five"];

/** The ledger title for a rating. Words, not digits: the normaliser strips numbers. */
export const titleFor = (rating) => `app store review rated ${WORDS[rating] ?? "unknown"} stars`;

/**
 * Which reviews to record, oldest first.
 * @param {Array<{id:string, attributes:{rating:number, title?:string, body?:string, createdDate:string, territory?:string}}>} reviews
 * @param {Map<string, string>} lastSeenByTitle ledger title -> last_seen ISO
 */
export function reviewsToRecord(reviews, lastSeenByTitle) {
  return reviews
    .filter((r) => Number.isInteger(r?.attributes?.rating) && r.attributes.rating <= 3)
    .filter((r) => {
      const last = lastSeenByTitle.get(titleFor(r.attributes.rating));
      return !last || Date.parse(r.attributes.createdDate) > Date.parse(last);
    })
    .sort((a, b) => Date.parse(a.attributes.createdDate) - Date.parse(b.attributes.createdDate))
    .map((r) => ({
      sourceKind: "user-report",
      source: SOURCE,
      title: titleFor(r.attributes.rating),
      severity: r.attributes.rating <= 2 ? "error" : "warning",
      sample: `${r.attributes.rating}/5 — ${r.attributes.title ?? ""}\n${r.attributes.body ?? ""}`.slice(0, 2000),
      sampleRef: {
        review_id: r.id,
        rating: r.attributes.rating,
        territory: r.attributes.territory ?? null,
        link: `https://appstoreconnect.apple.com/apps/${APP_APPLE_ID}/distribution/activity/ios/ratingsResponses`,
      },
      verifyKind: "manual",
      seenAt: r.attributes.createdDate,
    }));
}

async function main() {
  const { mintToken, asc } = await import("./asc/asc-client.mjs");
  const token = mintToken(); // throws with the missing names: fail closed
  const page = await asc(
    `/v1/apps/${APP_APPLE_ID}/customerReviews?sort=-createdDate&limit=200` +
      "&fields[customerReviews]=rating,title,body,createdDate,territory",
    { token },
  );
  const reviews = page?.data ?? [];
  const titles = [1, 2, 3].map(titleFor);
  const rows = await sql(
    `SELECT title, max(last_seen) AS last_seen FROM public.ops_alert_ledger
      WHERE source_kind = 'user-report' AND source = ${lit(SOURCE)}
        AND title IN (${titles.map(lit).join(", ")}) GROUP BY title`,
    { readOnly: true },
  );
  const last = new Map(rows.map((r) => [r.title, r.last_seen]));
  const todo = reviewsToRecord(reviews, last);
  console.log(`app store reviews: read ${reviews.length} newest; ${reviews.filter((r) => r.attributes?.rating <= 3).length} rated <= 3; ${todo.length} new to record.`);
  let failed = 0;
  for (const o of todo) {
    try {
      await sql(
        `SELECT public.ops_alert_record(${lit(o.sourceKind)}, ${lit(o.source)}, ${lit(o.title)}, ${lit(o.severity)}, ` +
          `${lit(o.sample)}, ${lit(JSON.stringify(o.sampleRef))}::jsonb, ${lit(o.verifyKind)}, NULL, ${lit(o.seenAt)}::timestamptz) AS id`,
      );
      console.log(`  recorded review ${o.sampleRef.review_id} (${o.title})`);
    } catch (e) {
      failed++;
      // The error names the transport, never the review text.
      console.log(`::error title=App Store review NOT recorded::review ${o.sampleRef.review_id}: ${String(e.message).split("\n")[0].slice(0, 200)}`);
    }
  }
  if (failed) process.exit(1);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main().catch((e) => {
    console.log(`::error title=App Store reviews unreadable::${String(e.message).split("\n")[0].slice(0, 300)}`);
    process.exit(1);
  });
}
