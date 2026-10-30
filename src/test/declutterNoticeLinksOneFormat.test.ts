/**
 * Declutter notices link in one format, ?tab=selling / ?tab=buying (Declutter audit DC-17, 2026-10-30). The class:
 * every Declutter notice link in the NEWEST definition of every function. Every notice is written by
 * declutter_notify_strict, which now rewrites the old seller/buyer addresses (?view=sales|selling|mine ->
 * ?tab=selling, ?view=bought|buying -> ?tab=buying) through declutter_notice_link; the senders that still name one
 * must reach that writer, never insert the notice themselves. ?view=cart and ?view=offers go to both sides, so the
 * writer cannot rewrite them; the exact list of every ?view= link left is a two-way ratchet: a NEW ?view= link fails,
 * and restating a sender to ?tab= must remove its entry. Behaviour: src/test/pglite/declutterNoticeLinksOneFormat.pglite.mjs
 * (3x; red with NEW_MIGRATION=skip).
 *
 * @mutate supabase/migrations/20261030133115_declutter_notice_links_one_format.sql |   v_link text := public.declutter_notice_link(p_link); |   v_link text := p_link;
 * @mutate supabase/migrations/20261030133115_declutter_notice_links_one_format.sql |           public.declutter_price_words(public.declutter_notice_names_item(p_user, p_other, v_link, p_message)), v_link); |           public.declutter_price_words(public.declutter_notice_names_item(p_user, p_other, v_link, p_message)), p_link);
 * @mutate supabase/migrations/20261030133115_declutter_notice_links_one_format.sql |     WHEN p_link ~ '^/declutter\?view=(sales\|selling\|mine)(&\|#\|$)' |     WHEN p_link ~ '^/declutter\?view=(sales\|selling)(&\|#\|$)'
 * @mutate supabase/migrations/20261017060455_declutter_seller_out_pays_fee.sql |     '/declutter?view=sales', o.buyer_id); |     '/declutter?view=cart', o.buyer_id);
 */
import { describe, expect, it } from "vitest";
import { effectiveDefs } from "./helpers/effectiveFunctionDefs";
import { newestFunction } from "./helpers/parityReaders";
import { blankSqlComments } from "./helpers/blankNonCode";

/**
 * Every ?view= link still in a function's newest definition (2026-10-30, after DC-17). "<dynamic>" is
 * '/declutter?view=' || CASE ... (side-chosen: sales/selling or cart). Lower it when a sender moves to ?tab=.
 */
const VIEW_LINKS_LEFT: Record<string, string> = {
  declutter_accept_refund_with_return: "buying,selling",
  declutter_add_handover: "cart",
  declutter_admin_decide_delivery_damage: "cart,deliver",
  declutter_admin_decide_problem: "cart,selling",
  declutter_answer_delivery_time: "<dynamic>",
  declutter_answer_refund: "buying,cart,selling",
  declutter_ask_refund: "selling",
  declutter_book_pickup: "<dynamic>",
  declutter_checkout_free: "cart",
  declutter_close_paid_order: "cart,sales",
  declutter_complete_handover: "cart",
  declutter_delivery_raise_paid: "cart",
  declutter_delivery_raises_on_task_close: "cart,sales",
  declutter_donation_job_completed: "mine",
  declutter_hand_refund_failed: "cart",
  declutter_handover_sweep: "cart",
  declutter_haul_away_job_refunded: "mine",
  declutter_haul_away_sweep: "mine",
  declutter_listing_rounds_sweep: "selling",
  declutter_mark_order_paid: "cart,selling",
  declutter_meetup_here: "bought,selling",
  declutter_notice_type: "deliver",
  declutter_pickup_reminder_sweep: "cart,selling",
  declutter_porch_photo: "sales",
  declutter_problem_add_side: "<dynamic>",
  declutter_propose_delivery_time: "<dynamic>,sales",
  declutter_record_hand_refund: "cart",
  declutter_record_refund: "selling",
  declutter_refund_after_handover: "cart,selling",
  declutter_refund_gave_up_check: "cart",
  declutter_refund_paid_order: "cart",
  declutter_refund_request_to_admin: "cart,selling",
  declutter_report_no_show: "cart",
  declutter_report_problem: "<dynamic>",
  declutter_return_dropped_off: "selling",
  declutter_seller_cancel_sale: "cart",
  declutter_seller_delivered: "cart",
  declutter_seller_delivery_on_order: "cart",
  declutter_seller_out_fee_notice: "sales",
  declutter_set_delivery_handoff: "sales",
  declutter_set_return_address: "selling",
  declutter_setup_fee_refunded: "cart",
  declutter_setup_job_fee_debt: "mine",
  declutter_take_item: "cart,selling",
  declutter_wanted_reply: "offers",
  declutter_withdraw_problem: "<dynamic>",
  declutter_withdraw_refund: "selling",
  helpr_task_close: "deliver",
  helpr_task_offer_online: "deliver",
  helpr_task_tip_paid: "deliver",
  helpr_task_tip_payout_sent: "deliver",
};
/** The old addresses the writer rewrites (and "<dynamic>", whose sales/selling half it rewrites). */
const REWRITTEN = new Set(["sales", "selling", "mine", "bought", "buying", "<dynamic>"]);

function viewLinks(): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [name, d] of effectiveDefs("supabase/migrations")) {
    const views = [...blankSqlComments(d.stmt).matchAll(/\/declutter\?view=([a-z_]*)/g)].map((m) => m[1] || "<dynamic>");
    if (views.length) out[name] = [...new Set(views)].sort().join(",");
  }
  return out;
}

describe("Declutter notices link in one format (DC-17)", () => {
  it("the writer stores every notice under the rewritten link, never the raw one", () => {
    const body = blankSqlComments(newestFunction("declutter_notify_strict").body);
    expect(body).toContain("v_link text := public.declutter_notice_link(p_link);");
    const insert = body.slice(body.indexOf("INSERT INTO public.notifications"));
    expect(insert.length).toBeGreaterThan(100);
    expect(insert).not.toMatch(/\bp_link\b/);
    expect(insert.match(/\bv_link\b/g)?.length).toBe(3);
    // declutter_notify still goes through it.
    expect(blankSqlComments(newestFunction("declutter_notify").body)).toContain("public.declutter_notify_strict(p_user, p_type, p_title, p_message, p_link, p_other)");
  });

  it("the link helper rewrites exactly the five old seller/buyer addresses, keeping the rest of the link", () => {
    const body = blankSqlComments(newestFunction("declutter_notice_link").body);
    expect(body).toContain("'^/declutter\\?view=(sales|selling|mine)(&|#|$)'");
    expect(body).toContain("'/declutter?tab=selling'");
    expect(body).toContain("'^/declutter\\?view=(bought|buying)(&|#|$)'");
    expect(body).toContain("'/declutter?tab=buying'");
    expect(body).not.toMatch(/view=\(?[a-z|]*\b(cart|offers|deliver|wanted)\b/);
  });

  it("every sender of an old address reaches the writer (no notice inserted around it)", () => {
    const links = viewLinks();
    const senders = Object.entries(links).filter(([name, v]) => name !== "declutter_notice_type" && v.split(",").some((x) => REWRITTEN.has(x)));
    expect(senders.length).toBeGreaterThan(20);
    expect(blankSqlComments(newestFunction("declutter_pickup_remind").body)).toMatch(/PERFORM public\.declutter_notify(_strict)?\(p_user, /);
    const defs = effectiveDefs("supabase/migrations");
    for (const [name] of senders) {
      const body = blankSqlComments(defs.get(name)?.stmt ?? "");
      // declutter_pickup_remind is the reminders' wrapper around declutter_notify (it also queues an email).
      expect(body, name).toMatch(/public\.declutter_(notify|notify_strict|pickup_remind)\(/);
      expect(body, `${name} inserts a notice itself, around the writer`).not.toMatch(/INSERT INTO public\.notifications/i);
    }
  });

  it("no NEW ?view= link: the list left is exact (lower it when a sender moves to ?tab=)", () => {
    const links = viewLinks();
    expect(Object.keys(links).length).toBeGreaterThan(40);
    expect(links).toEqual(VIEW_LINKS_LEFT);
  });
});
