/**
 * Q2106 step 3 (WIP): declutter-checkout's pay takes ONE gift card and charges the card only what is left.
 * Source read (comments blanked): the gift is redeemed by redeem_gift_card_for_declutter_order before any page is
 * made; covered in full answers paid with no page; otherwise the page charges the remainder as one line, the amount
 * check is against that remainder, and the redeem's answer must add up to the order's full price. An open page is
 * closed before the gift takes the order (redeem's p_retired_session).
 *
 * @mutate supabase/functions/declutter-checkout/index.ts |     if (r?.outcome === "settled") return json({ paid: true, order_id: order.order_id, gift_cents: Number(r.applied_cents ?? 0) }); |
 * @mutate supabase/functions/declutter-checkout/index.ts |         \|\| applied <= 0 \|\| rest + applied !== fullChargeCents) { |         \|\| applied <= 0) {
 * @mutate supabase/functions/declutter-checkout/index.ts |       retiredSession = row!.checkout_session_id; |
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { blankComments } from "./helpers/blankNonCode";

const SRC = blankComments(readFileSync(join(process.cwd(), "supabase/functions/declutter-checkout/index.ts"), "utf8"));

describe("declutter-checkout: one gift card pays first (Q2106)", () => {
  it("redeems the gift before any page is made, and a full cover opens no page", () => {
    const redeem = SRC.indexOf('admin.rpc("redeem_gift_card_for_declutter_order"');
    expect(redeem).toBeGreaterThan(0);
    expect(redeem).toBeLessThan(SRC.indexOf("stripe.checkout.sessions.create("));
    expect(SRC).toContain('if (r?.outcome === "settled") return json({ paid: true, order_id: order.order_id, gift_cents: Number(r.applied_cents ?? 0) });');
  });
  it("charges only the remainder, checked against the order's full price", () => {
    expect(SRC).toContain("|| applied <= 0 || rest + applied !== fullChargeCents) {");
    expect(SRC).toContain("chargeCents = rest;");
    expect(SRC).toMatch(/if \(session\.amount_total !== chargeCents\)/);
  });
  it("closes an open page first and hands it to the redeem as retired", () => {
    expect(SRC).toContain("retiredSession = row!.checkout_session_id;");
    expect(SRC).toContain("p_retired_session: retiredSession");
  });
});
