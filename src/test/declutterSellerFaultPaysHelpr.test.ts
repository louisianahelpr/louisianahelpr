/**
 * Q1938 (owner 11-03: "whatever the rule is for jobs is the same for declutter"): a seller-fault Declutter
 * setup cancel pays the committed Helpr like a jobs late cancel, and the database layers agree:
 *   - declutter_setup_job_fee_debt bills the seller the Helpr fee beside the card fee (p_helpr_fee_cents);
 *   - declutter_apply_seller_fault tells a Helpr who is paid "you'll be paid for your time", using the same
 *     test void-cancelled-payments prices with (committed, a budget, the ladder's percent at now()), and any
 *     other Helpr a neutral line with no fee or payment words.
 * Reads the EFFECTIVE definitions (effectiveDefs: the newest CREATE plus in-place rewrites).
 * Backend proofs: src/test/pglite/declutterSellerFaultPaysHelpr.pglite.mjs and
 * src/test/pglite/declutterSellerFaultHelprNotice.pglite.mjs (3x replay; NEW_MIGRATION=skip RED).
 *
 * @mutate supabase/migrations/20261103214533_declutter_seller_fault_pays_helpr.sql |   v_fee := least(p_card_fee_cents + p_helpr_fee_cents, COALESCE(v_cap, 0)); |   v_fee := least(p_card_fee_cents, COALESCE(v_cap, 0));
 * @mutate supabase/migrations/20261103215616_declutter_seller_fault_helpr_notice.sql |                 AND public.cancellation_fee_percent(true, public.job_hours_until_start(jb.date_needed, jb.start_time, now())) > 0) AS paid_for_time |                 AND false) AS paid_for_time
 * @mutate supabase/migrations/20261103215616_declutter_seller_fault_helpr_notice.sql | It was not the poster''s choice.', COALESCE | It was not the poster''s choice, so there is no payment for it.', COALESCE
 */
import { describe, expect, it } from "vitest";
import { join, resolve } from "node:path";
import { blankSqlComments } from "./helpers/blankNonCode";
import { effectiveDefs } from "./helpers/effectiveFunctionDefs";

const REPO = resolve(__dirname, "..", "..");
const DEFS = effectiveDefs(join(REPO, "supabase", "migrations"));
const body = (fn: string) => blankSqlComments(DEFS.get(fn)?.stmt ?? "").replace(/\s+/g, " ");

describe("Q1938: a seller-fault Declutter setup cancel pays the committed Helpr like jobs", () => {
  it("the inventory read both functions", () => {
    expect(DEFS.size).toBeGreaterThan(500);
    expect(body("declutter_setup_job_fee_debt").length).toBeGreaterThan(500);
    expect(body("declutter_apply_seller_fault").length).toBeGreaterThan(500);
  });

  it("the seller's debt is the card fee plus the Helpr fee, under the per-job cap", () => {
    const b = body("declutter_setup_job_fee_debt");
    expect(b).toMatch(/p_helpr_fee_cents integer DEFAULT 0/);
    expect(b).toContain("v_fee := least(p_card_fee_cents + p_helpr_fee_cents, COALESCE(v_cap, 0));");
  });

  it("the Helpr notice names pay only when the jobs ladder pays, and is neutral otherwise", () => {
    const b = body("declutter_apply_seller_fault");
    expect(b).toMatch(/jb\.helper_confirmed_at IS NOT NULL AND COALESCE\(jb\.budget, 0\) > 0 AND jb\.date_needed IS NOT NULL AND public\.cancellation_fee_percent\(true, public\.job_hours_until_start\(jb\.date_needed, jb\.start_time, now\(\)\)\) > 0\) AS paid_for_time/);
    expect(b).toContain("CASE WHEN j.paid_for_time THEN format(");
    expect(b).toContain("The seller cancelled, so you''ll be paid for your time.");
    const neutral = /ELSE format\('"%s" was cancelled: on the Declutter order it was booked for, %s\. ([^']|'')*'/.exec(b)?.[0] ?? "";
    expect(neutral).not.toBe("");
    expect(neutral).not.toMatch(/\bfee\b|payment|paid|\bpay\b/i);
  });
});
