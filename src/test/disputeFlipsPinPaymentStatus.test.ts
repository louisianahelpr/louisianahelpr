// Q1192 class guard. A money action that flips a job to a terminal payment_status
// after a Stripe call must pin the flip on the payment_status it read, or a
// chargeback block (charge.dispute.created -> 'chargeback') landing during the
// Stripe call is overwritten. Quick Release and Quick Refund pinned only status.
// @mutate supabase/functions/create-payment/index.ts | .eq("status", "disputed").in("payment_status", [...DISPUTE_RELEASE_FLIP_PAYMENT_STATES]).select("id");\n      if (!releaseUpdateErr | .eq("status", "disputed").select("id");\n      if (!releaseUpdateErr
// @mutate supabase/functions/create-payment/index.ts | .eq("status", "disputed").in("payment_status", [...DISPUTE_REFUND_FLIP_PAYMENT_STATES]).select("id");\n      if (!refundUpdateErr | .eq("status", "disputed").select("id");\n      if (!refundUpdateErr
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { blankComments } from "./helpers/blankNonCode";

const FILE = "supabase/functions/create-payment/index.ts";
const src = blankComments(readFileSync(resolve(__dirname, "../..", FILE), "utf8"));

/** Every terminal payment_status write (released, refunded, cancelled) in a jobs update payload. */
const TERMINAL_WRITE = new RegExp(`payment_status:\\s*"(${["released", "refunded", "cancelled"].join("|")})"`, "g");
// The pin must sit in the same chain: before the next job write begins.
const PIN = /\.(?:eq|in|is)\(\s*"payment_status"/;

function unpinnedWrites(text: string): string[] {
  const bad: string[] = [];
  const hits = [...text.matchAll(TERMINAL_WRITE)];
  hits.forEach((m, i) => {
    const from = m.index ?? 0;
    const end = Math.min(from + 1500, hits[i + 1]?.index ?? text.length);
    if (!PIN.test(text.slice(from, end))) {
      const line = text.slice(0, from).split("\n").length;
      bad.push(`${FILE}:${line} writes payment_status ${m[1]} with no payment_status pin in its chain`);
    }
  });
  return bad;
}

describe("Q1192: terminal payment_status flips in create-payment are pinned on payment_status", () => {
  it("inventory: finds the terminal flips (floor)", () => {
    expect([...src.matchAll(TERMINAL_WRITE)].length).toBeGreaterThan(4);
  });

  it("every released/refunded/cancelled flip carries a payment_status pin", () => {
    expect(unpinnedWrites(src)).toEqual([]);
  });

  it("the scanner flags an unpinned flip (shown able to fail)", () => {
    const planted = 'await db.from("jobs").update({ payment_status: "released" }).eq("id", id).eq("status", "disputed").select("id");';
    expect(unpinnedWrites(planted)).toHaveLength(1);
  });
});
