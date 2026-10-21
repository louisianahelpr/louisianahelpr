/**
 * Board 144 (copy only): a Helpr's cancel tells the poster the payment is
 * still held, and only while it really is (payment_status 'escrow'), because
 * helper_cancel_booking reopens the job without touching the payment.
 *
 * @mutate src/components/job-card/BackoutBanner.tsx | kind === "helper_cancelled" && moneyHeld ? | kind === "helper_cancelled" ?
 */
import { describe, expect, it } from "vitest";
import { join } from "node:path";
import { backoutMoneyLine } from "@/components/job-card/BackoutBanner";
import { blankSqlComments } from "@/test/helpers/blankNonCode";
import { effectiveDefs } from "@/test/helpers/effectiveFunctionDefs";

describe("board 144: the backout banner's money line", () => {
  it("shows only for a Helpr cancel on a still-held payment", () => {
    expect(backoutMoneyLine("helper_cancelled", true)).toMatch(/stays held/);
    expect(backoutMoneyLine("helper_cancelled", false)).toBeNull();
    expect(backoutMoneyLine("poster_cancelled", true)).toBeNull();
    expect(backoutMoneyLine("offer_declined", true)).toBeNull();
  });

  it("the premise holds: helper_cancel_booking's reopen leaves payment_status alone", () => {
    const def = effectiveDefs(join(process.cwd(), "supabase/migrations")).get("helper_cancel_booking");
    const fn = blankSqlComments(def?.stmt ?? "");
    expect(fn.length).toBeGreaterThan(1000);
    const reopen = /UPDATE public\.jobs\s+SET status = 'open',[\s\S]*?WHERE id = v_job\.id;/.exec(fn)?.[0] ?? "";
    expect(reopen).toContain("helper_id = NULL");
    expect(reopen).not.toMatch(/payment_status/);
  });
});
