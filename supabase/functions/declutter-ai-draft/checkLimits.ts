/**
 * A POSTED LISTING'S CHECK HAS ITS OWN LIMIT. Drafts, room and bunch sorting share 12 a minute in index.ts
 * (LEAD-BUNCH-34-SLOW, owner 10-31; each mode's hourly limit caps the cost).
 *
 * Owner 10-31, 9:15 PM: 27 of a Sell a bunch post were held by the 15-minute fail-safe with no check recorded. Measured
 * in the edge logs on 2026-10-31, 02:18-02:21Z: the checks shared the 12-a-minute bucket with the session's other calls, the 13th
 * call in a minute answered 429, and every refused try still counted, so the app's paced checks (every 5.25 s, each
 * asked again at once) kept the bucket full: 40+ answers of 429 in a row and not one more check recorded. A check is
 * not a cost the member chooses (one per posted listing; the server holds the listing without it), so it gets room for
 * a whole bunch with retries: 30 a minute, 300 an hour. Guard: src/test/declutterCheckHasItsOwnLimit.test.ts.
 */
export const CHECK_MINUTE_LIMIT = { windowMs: 60_000, maxRequests: 30, keyPrefix: "declutter-ai-check" };

/** A check's hourly cap, on top of the per-minute one: a bunch of 50 listings a few times over, never a runaway. */
export const CHECK_HOURLY_LIMIT = { windowMs: 3_600_000, maxRequests: 300, keyPrefix: "declutter-ai-check-hour" };
