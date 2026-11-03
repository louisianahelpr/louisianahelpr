/**
 * Q1916 (poster half): a gift-funded job's cancellation fee never says "charged" in red. jobs.cancellation_fee_status
 * 'charged' means the fee was taken; void-cancelled-payments takes it from the gift first on a gift-funded job and
 * gives back the rest (restore_gift_card_for_job: a row with restored_from_job_id = the job). What the gift kept is
 * counted as the RPC counts it: applied = credit - leftover children; kept = applied - restored.
 *
 * @mutate src/pages/posts/postedJobCard/PosterCancelFeeLine.tsx |   if (fromGift >= feeCents) return | if (false) return
 * @mutate src/pages/posts/postedJobCard/PosterCancelFeeLine.tsx |     .filter((r) => r.parent_credit_id === credit.id && r.restored_from_job_id == null) |     .filter((r) => r.parent_credit_id === credit.id)
 * @mutate src/pages/posts/postedJobCard/PosterCancelFeeLine.tsx |   if (keptCents === undefined) return | if (keptCents === 0.5) return
 * @mutate src/pages/posts/PostedJobCard.tsx | <PosterCancelFeeLine jobId={job.id} | <PosterCancelFeeLine jobId={""}
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { giftKeptCents, posterCancelFeeLine, type GiftRow } from "./PosterCancelFeeLine";
import { blankComments } from "@/test/helpers/blankNonCode";

const JOB = "job-1";
const row = (r: Partial<GiftRow> & { id: string }): GiftRow => ({
  amount: 0, status: "sent", job_id: null, parent_credit_id: null, restored_from_job_id: null, ...r,
});

describe("Q1916: what the gift kept, counted as restore_gift_card_for_job counts it", () => {
  it("a $100 gift, $60 spent ($40 leftover child), $45 restored: kept $15", () => {
    const rows = [
      row({ id: "g", amount: 100, status: "redeemed", job_id: JOB }),
      row({ id: "left", amount: 40, parent_credit_id: "g" }),
      row({ id: "back", amount: 45, parent_credit_id: "g", restored_from_job_id: JOB }),
    ];
    expect(giftKeptCents(JOB, rows)).toBe(1500);
  });
  it("no restore row: the whole applied amount was kept", () => {
    expect(giftKeptCents(JOB, [row({ id: "g", amount: 30, status: "redeemed", job_id: JOB })])).toBe(3000);
  });
  it("no gift spent on this job: null", () => {
    expect(giftKeptCents(JOB, [row({ id: "g", amount: 30, status: "redeemed", job_id: "other" })])).toBeNull();
  });
});

describe("Q1916: the poster's cancelled-job fee line", () => {
  it("fee kept from the gift in full: 'paid with your gift card', not red", () => {
    expect(posterCancelFeeLine("charged", 15, 1500)).toEqual({ label: "$15 for your Helpr's time · paid with your gift card", cardCharged: false });
  });
  it("no gift on the job (or the gift kept nothing): charged, red", () => {
    for (const kept of [null, 0]) {
      expect(posterCancelFeeLine("charged", 15, kept)).toEqual({ label: "$15 for your Helpr's time · charged", cardCharged: true });
    }
  });
  it("part gift, part card: both amounts", () => {
    expect(posterCancelFeeLine("charged", 15, 500).label).toBe("$15 for your Helpr's time · $5 from your gift card, $10 charged");
  });
  it("not read yet or unreadable: neither 'charged' nor 'gift card'", () => {
    const line = posterCancelFeeLine("charged", 15, undefined);
    expect(line.cardCharged).toBe(false);
    expect(line.label).not.toMatch(/charged|gift/);
  });
  it("pending and waived keep their lines", () => {
    expect(posterCancelFeeLine("pending", 15, 1500).label).toBe("$15 for your Helpr's time · pending");
    expect(posterCancelFeeLine("waived", 15, null).label).toBe("Nothing to your Helpr · waived");
  });
  it("the card mounts the line and no longer maps 'charged' itself", () => {
    const src = blankComments(readFileSync("src/pages/posts/PostedJobCard.tsx", "utf8"));
    expect(src).toContain("<PosterCancelFeeLine jobId={job.id} fee={job.cancellation_fee} status={job.cancellation_fee_status} posterId={userId} />");
    expect(src).not.toMatch(/charged:\s*`\$\{feeAmt\}/);
  });
});
