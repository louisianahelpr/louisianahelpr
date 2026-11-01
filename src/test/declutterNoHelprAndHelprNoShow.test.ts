/**
 * BUY-2 and soldstates-5 (owner 10-31 morning), the server rules, read from the newest definitions.
 *   BUY-2: when no Helpr took a delivery, the buyer may cancel for a refund and the BUYER bears the card fee
 *     (20261031133938). Behaviour: src/test/pglite/declutterNoHelprBuyerRefund.pglite.mjs (3x; NEW_MIGRATION=skip red).
 *   soldstates-5: the seller's "The Helpr didn't come" holds the money, tells the Helpr at once, 24 hours to answer,
 *     no answer = a strike (20261031134217). Behaviour: src/test/pglite/helprDeliverySellerReportsNoShow.pglite.mjs.
 *
 * @mutate supabase/migrations/20261031133938_declutter_no_helpr_buyer_refund.sql | RETURN public.declutter_close_paid_order(o.id, 'buyer_cancelled', NULL, NULL, NULL); | RETURN public.declutter_close_paid_order(o.id, 'admin_no_fault', NULL, NULL, NULL);
 * @mutate supabase/migrations/20261031133938_declutter_no_helpr_buyer_refund.sql |   v_fee := least(v_fee, v_paid - 1); |   v_fee := 0;
 * @mutate supabase/migrations/20261031134217_helpr_delivery_seller_reports_no_show.sql | SET seller_no_show_reported_at = now(), seller_no_show_answer_by = now() + interval '24 hours', updated_at = now() | SET seller_no_show_reported_at = now(), seller_no_show_answer_by = now() + interval '72 hours', updated_at = now()
 * @mutate supabase/migrations/20261031231150_helpr_delivery_cant_finish.sql |           PERFORM public.helpr_task_give_job_strike(t.helpr_id, 'delivery_no_show', t.id,\n            'The seller said | PERFORM public.helpr_task_log(t.id, 'helpr_no_show', t.helpr_id,\n            'The seller said
 * @mutate supabase/migrations/20261031134217_helpr_delivery_seller_reports_no_show.sql | VALUES (o.id, v_uid, 'helpr', 'no_show', btrim(p_note), | VALUES (o.id, v_uid, 'seller', 'no_show', btrim(p_note),
 * LEAD-BUY44 (20261031140431): the seller is told Delivered. Behaviour: src/test/pglite/helprDeliverySellerToldDelivered.pglite.mjs.
 * @mutate supabase/migrations/20261031170803_declutter_no_helpr_notice_offers_refund.sql |     PERFORM public.declutter_notify(o.seller_id, 'payment', 'Delivered', |     PERFORM public.declutter_notify(o.buyer_id, 'payment', 'Delivered',
 * LEAD-NOHELPR-NOTICE (20261031170803): the two no-Helpr notices name BUY-2's cancel. Behaviour:
 *   src/test/pglite/declutterNoHelprNoticeOffersRefund.pglite.mjs (3x; NEW_MIGRATION=skip red, 2 mutants red). No fee is
 *   named anywhere (membersSeeNoFeeWords): the Buying card shows the amount that comes back.
 * @mutate supabase/migrations/20261031170803_declutter_no_helpr_notice_offers_refund.sql |  or cancel the sale for a refund. Buying shows how much comes back before you choose.', | .',
 * AUD31-24 part: the Terms and the checkout's delivery line say the same.
 * @mutate src/pages/info/legal/TermsSection.tsx | , or cancel the sale for a refund. Buying shows how much comes back before you choose.</p> | .</p>
 * @mutate src/components/declutter/DeclutterTradeViews.tsx | , or cancel for a refund.</p> | .</p>
 * @mutate supabase/migrations/20261031170803_declutter_no_helpr_notice_offers_refund.sql | The buyer can book a pickup at your home or cancel the sale. If they cancel, your item goes back on sale.' | The buyer will book a pickup at your home.'
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { newestFunction } from "./helpers/parityReaders";
import { blankSqlComments } from "./helpers/blankNonCode";

const flat = (name: string) => blankSqlComments(newestFunction(name).body).replace(/\s+/g, " ");

describe("BUY-2: the buyer's cancel after no Helpr", () => {
  it("reads the newest definitions", () => {
    for (const n of ["declutter_no_helpr_refusal", "declutter_no_helpr_choice", "declutter_cancel_after_no_helpr"]) {
      expect(newestFunction(n).file, n).toContain("20261031133938");
      expect(flat(n).length, n).toBeGreaterThan(600);
    }
  });

  it("closes with the reason whose policy keeps the card fee (the buyer bears it), no strike", () => {
    expect(flat("declutter_cancel_after_no_helpr")).toContain("RETURN public.declutter_close_paid_order(o.id, 'buyer_cancelled', NULL, NULL, NULL);");
    // The policy that reason gets: keep_card_fee (declutter_record_refund).
    expect(flat("declutter_record_refund")).toMatch(/WHEN p_reason IN \('buyer_cancelled'[^)]*\) THEN 'keep_card_fee'/);
  });

  it("the screen's sums are the refund's: card fee kept, at least 1 cent back", () => {
    const c = flat("declutter_no_helpr_choice");
    expect(c).toContain("v_paid := o.total_cents - public.declutter_delivery_reserved_cents(o.id);");
    expect(c).toContain("v_fee := least(v_fee, v_paid - 1);");
    expect(c).toContain("'refund_cents', v_paid - v_fee");
  });
});

describe("soldstates-5: the seller's 'The Helpr didn't come'", () => {
  it("24 hours to answer; held while it waits; no answer is a strike", () => {
    expect(flat("declutter_report_helpr_no_show")).toContain("seller_no_show_answer_by = now() + interval '24 hours'");
    expect(flat("helpr_task_source_held")).toContain("x.seller_no_show_reported_at IS NOT NULL AND x.seller_no_show_answered_at IS NULL AND x.seller_no_show_settled_at IS NULL");
    const sweep = flat("helpr_task_sweep");
    // BUY-36 (20261031231150) restated the sweep; the strike line below still reads the newest one.
    expect(newestFunction("helpr_task_sweep").file).toContain("20261031231150");
    expect(sweep).toContain("PERFORM public.helpr_task_give_job_strike(t.helpr_id, 'delivery_no_show', t.id, 'The seller said");
  });

  it("the Helpr's answer is the Helpr's problem, so the admin can't 'Pay the seller' for an item that never left", () => {
    expect(flat("declutter_helpr_answer_no_show")).toContain("VALUES (o.id, v_uid, 'helpr', 'no_show', btrim(p_note),");
    expect(flat("declutter_admin_decide_problem")).toContain("IF p_decision = 'pay_seller' AND p.reporter_side = 'helpr' THEN");
  });
});

describe("LEAD-BUY44: the seller hears a Helpr delivery was delivered", () => {
  it("the 'delivered' step tells the seller, naming the item, opening Selling", () => {
    expect(newestFunction("declutter_delivery_on_task_event").file).toContain("20261031170803");
    expect(flat("declutter_delivery_on_task_event")).toContain(
      "PERFORM public.declutter_notify(o.seller_id, 'payment', 'Delivered', format('The Helpr left %s at the buyer''s address.");
  });
});

describe("LEAD-NOHELPR-NOTICE: the no-Helpr notices offer BUY-2's cancel", () => {
  it("the buyer is offered the cancel and pointed to the amount; the seller is told the buyer may cancel", () => {
    const body = flat("declutter_delivery_on_task_event");
    expect(body).toContain(
      "Book a time to pick up at the seller''s home before your 7-day deadline, or cancel the sale for a refund. Buying shows how much comes back before you choose.'");
    expect(body).toContain(
      "The buyer can book a pickup at your home or cancel the sale. If they cancel, your item goes back on sale.'");
    // The cancel the words promise exists, with the card fee kept (BUY-2 above).
    expect(newestFunction("declutter_cancel_after_no_helpr").file).toContain("20261031133938");
  });
});

describe("AUD31-24 part: the Terms and checkout say the buyer may cancel after no Helpr", () => {
  const src = (p: string) => readFileSync(p, "utf8");
  it("the Terms' Declutter line", () => {
    expect(src("src/pages/info/legal/TermsSection.tsx")).toContain(
      "everything you paid for delivery comes back to you. Then you pick it up at the seller&apos;s door, or cancel the sale for a refund. Buying shows how much comes back before you choose.</p>");
  });
  it("the checkout's Helpr delivery line", () => {
    expect(src("src/components/declutter/DeclutterTradeViews.tsx")).toContain(
      "what you paid for delivery comes back. Then you pick it up instead, or cancel for a refund.</p>");
  });
});
