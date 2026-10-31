/**
 * LEAD-DOOR-PAYLINE: every Declutter seller payout line says the owner's 10-30 rule ("Declutter handover money"):
 * the buyer's "I got it" pays the seller (24 hours later: the buyer's refund window, declutter_sale_final); the seller's
 * own step with the buyer silent pays in about 48 hours (the handover sweep's 24 h + sale_final's 24 h); nobody says
 * anything, the money stays held. The door card said "paid 24 hours after the handover ... the handover is ... 24 hours
 * after you tap Picked up" next to "about 48 hours", and the Helpr-delivery and seller-delivery lines said "when the
 * buyer confirms, or after 24 hours" (a day early both ways).
 *
 * The second half reads every Declutter seller-facing source file and refuses the old wordings anywhere in code.
 *
 * @mutate src/lib/declutter/sellerPayoutRule.ts | If you tap "Picked up" and the buyer says nothing, you're paid about 48 hours later. | If you tap "Picked up", you're paid 24 hours later.
 * @mutate src/lib/declutter/sellerPayoutRule.ts | If neither of you says anything, the money stays held. | If neither of you says anything, you're paid after 7 days.
 * @mutate src/lib/declutter/sellerPayoutRule.ts | If you mark it delivered and the buyer says nothing, you're paid about 48 hours later. | If you mark it delivered, you're paid in 24 hours.
 * @mutate src/components/declutter/DeclutterDeliveryViews.tsx | left it at the buyer's address. ${sellerPayoutRule("delivery")} | left it at the buyer's address. You're paid when the buyer confirms, or after 24 hours.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { readdirSync } from "@/test/helpers/trackedFiles";
import { join } from "node:path";
import { sellerPayoutRule, type SellerPayoutKind } from "./sellerPayoutRule";
import { blankComments } from "@/test/helpers/blankNonCode";

const KINDS: SellerPayoutKind[] = ["pickup_home", "meetup", "porch", "seller_delivery", "delivery"];

describe("the seller's payout rule, per handover kind", () => {
  it.each(KINDS)("%s: 'I got it' pays 24 hours later (refund window), the seller's own step about 48 hours", (kind) => {
    const r = sellerPayoutRule(kind);
    expect(r).toMatch(/^You're paid 24 hours after the buyer taps "I got it"/);
    expect(r).toMatch(/unless they ask for a refund\./);
    expect(r).toMatch(/about 48 hours/);
    // Never a 24-hour auto-pay from the seller's own word.
    expect(r).not.toMatch(/24 hours after you|after 24 hours|when the buyer confirms/);
  });

  it("door and meeting spot: nobody says anything, the money stays held (owner 10-30: no auto-pay)", () => {
    for (const k of ["pickup_home", "meetup"] as const) {
      expect(sellerPayoutRule(k)).toContain('If you tap "Picked up" and the buyer says nothing, you\'re paid about 48 hours later.');
      expect(sellerPayoutRule(k)).toContain("If neither of you says anything, the money stays held.");
    }
  });

  it("porch: about 48 hours from the later of the pickup time and the porch photo; no photo, held", () => {
    expect(sellerPayoutRule("porch")).toContain("about 48 hours after the later of the pickup time and your porch photo");
    expect(sellerPayoutRule("porch")).toContain("With no porch photo, the money stays held until the buyer confirms.");
  });

  it("seller delivery and Helpr delivery: the delivery plus the buyer's silence is about 48 hours", () => {
    expect(sellerPayoutRule("seller_delivery")).toContain("If you mark it delivered and the buyer says nothing, you're paid about 48 hours later.");
    expect(sellerPayoutRule("delivery")).toContain("you're paid about 48 hours after the drop-off.");
  });
});

describe("no Declutter seller line keeps an old payout wording", () => {
  const DIR = join(process.cwd(), "src", "components", "declutter");
  const files = readdirSync(DIR).filter((f) => /\.tsx?$/.test(f) && !/\.test\./.test(f));
  const OLD = [
    /24 hours after you tap "Picked up"/,
    /You're paid 24 hours after the handover/,
    /You're paid when the buyer confirms, or in about 48 hours/,
    /left it at the buyer's address. You're paid when the buyer confirms/,
    /once the sale is final: 24 hours after the handover, unless the buyer asks for a refund\.<\/>/,
  ];

  it("reads the Declutter components", () => {
    expect(files.length).toBeGreaterThan(50);
  });

  it.each(OLD.map((re) => [String(re), re] as const))("%s appears in no Declutter component's code", (_name, re) => {
    const hits = files.filter((f) => re.test(blankComments(readFileSync(join(DIR, f), "utf8"))));
    expect(hits).toEqual([]);
  });
});
