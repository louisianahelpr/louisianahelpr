/**
 * postSlackOpsAlert (supabase/functions/_shared/slack-alerts.ts): the once-per-day dedupe runs
 * BEFORE the hourly cap, and the cap counts only alerts that actually went out (/code-review of
 * the payout-readiness change, v6 #3 / v7 #3). Before: a duplicate's claim row and a capped or
 * failed post's row all counted toward postsThisHour, so a busy kind could keep a payout page out
 * of the channel for good; and a capped call kept the day's key, so it was never retried.
 *
 * @mutate supabase/functions/_shared/slack-alerts.ts |      'tags->>deduped': 'is.null', |
 * @mutate supabase/functions/_shared/slack-alerts.ts |      'tags->>undelivered': 'is.null', |
 * @mutate supabase/functions/_shared/slack-alerts.ts |        // Not delivered: give the once-per-day key back so the next run tries again.\n        if (heldKey) await releaseAlertKey(heldKey.rowId, input, heldKey.key) |
 * @mutate supabase/functions/_shared/slack-alerts.ts |        await tagAlertRow(rowId, input, { alert_key: input.oncePerDayKey, deduped: input.oncePerDayKey }) |
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { blankComments } from "./helpers/blankNonCode";

const SRC = blankComments(readFileSync("supabase/functions/_shared/slack-alerts.ts", "utf8"));
const fnStart = SRC.indexOf("export async function postSlackOpsAlert(");
const BODY = SRC.slice(fnStart, SRC.indexOf("\n}\n", fnStart));

describe("postSlackOpsAlert: dedupe before the cap; only delivered posts count", () => {
  it("reads the real function (floor)", () => {
    expect(fnStart).toBeGreaterThan(0);
    expect(BODY.length).toBeGreaterThan(2000);
  });

  it("claims the once-per-day key before the hourly cap", () => {
    const claim = BODY.indexOf("isFirstToday(input.oncePerDayKey");
    const cap = BODY.indexOf("postsThisHour(input.kind)");
    expect(claim).toBeGreaterThan(0);
    expect(cap).toBeGreaterThan(claim);
  });

  it("tags a duplicate so it is not counted, and gives the key back when capped", () => {
    expect(BODY).toMatch(/tagAlertRow\(rowId, input, \{ alert_key: input\.oncePerDayKey, deduped: input\.oncePerDayKey \}\)/);
    const capped = BODY.slice(BODY.indexOf("capped: 'hourly'"), BODY.indexOf("return false", BODY.indexOf("capped: 'hourly'")));
    expect(capped).toMatch(/releaseAlertKey\(heldKey\.rowId, input, heldKey\.key\)/);
  });

  it("postsThisHour counts only delivered rows", () => {
    const q = SRC.slice(SRC.indexOf("async function postsThisHour("), SRC.indexOf("async function isFirstToday("));
    for (const tag of ["capped", "deduped", "undelivered_alert_key", "undelivered"]) {
      expect(q, tag).toContain(`'tags->>${tag}': 'is.null'`);
    }
  });

  it("every failed post marks its plain row undelivered", () => {
    expect(BODY.split("tagAlertRow(plainRowId, input, { undelivered: '1' })").length - 1).toBe(3);
  });
});
