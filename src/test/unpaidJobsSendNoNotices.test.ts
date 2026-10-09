/**
 * A JOB NOBODY PAID FOR SENDS NO NOTICES (owner report, 2026-10-09). Ben moved
 * his paid "Lawn service needed" to Sunday and was then told "Job
 * auto-cancelled ... no helpr assigned" about "Grass cutting", a first try
 * whose checkout he never finished (payment_status 'abandoned'), so it was
 * never shown to anyone. It had also sent him "expires soon ... Boost it".
 * An unfunded listing now closes quietly, and the expiry reminder is for
 * funded (escrow) listings only.
 *
 * @mutate supabase/functions/auto-expire-jobs/index.ts |       if (!FUNDED_STATUSES.has(job.payment_status ?? "")) { |       if (false) {
 * @mutate supabase/functions/expiring-jobs-push/index.ts |       .eq("payment_status", "escrow") |       .neq("payment_status", "__none__")
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { blankComments } from "./helpers/blankNonCode";

const expire = blankComments(readFileSync("supabase/functions/auto-expire-jobs/index.ts", "utf8"));
const remind = blankComments(readFileSync("supabase/functions/expiring-jobs-push/index.ts", "utf8"));

describe("never-funded jobs send no auto-cancel or expiry notices", () => {
  it("auto-expire-jobs closes an unfunded listing without notifying, before the auto-cancelled notice", () => {
    expect(expire).toMatch(/const FUNDED_STATUSES = new Set\(\["escrow", "payout_pending", "released"\]\)/);
    const skip = expire.indexOf('if (!FUNDED_STATUSES.has(job.payment_status ?? "")) {');
    const notice = expire.indexOf('title: "Job auto-cancelled"');
    expect(skip).toBeGreaterThan(-1);
    expect(notice).toBeGreaterThan(skip);
    expect(expire.slice(skip, notice)).toMatch(/continue;/);
  });
  it("expiring-jobs-push only reminds about funded (escrow) listings", () => {
    const q = remind.slice(remind.indexOf('.from("jobs")'), remind.indexOf(".lte(\"expires_at\""));
    expect(q).toMatch(/\.eq\("payment_status", "escrow"\)/);
  });
});
