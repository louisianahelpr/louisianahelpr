/**
 * Q2465 (lead 2026-11-01): pure reminder sends use declutter_notify_strict, so a reminder that cannot be written is
 * retried next run instead of being marked sent. declutter_deadline_sweep's 24-hour and 2-hour checkout reminders run
 * each line in its own block that clears the line's claim on failure; declutter_handover_sweep (d)'s "Delivery coming
 * up" sends sit in the order's own block, so a failure rolls the reminded_hours mark back with them. Reads the EFFECTIVE
 * definitions. Backend proof (deadline sweep): src/test/pglite/declutterRemindersRetryStrict.pglite.mjs.
 *
 * @mutate supabase/migrations/20261112004748_declutter_seller_notices_name_the_buyer.sql |     UPDATE public.declutter_cart_items SET reminded_24h_at = NULL WHERE id = r.id;\n |
 * @mutate supabase/migrations/20261112004748_declutter_seller_notices_name_the_buyer.sql |     UPDATE public.declutter_cart_items SET reminded_2h_at = NULL WHERE id = r.id;\n |
 * @mutate supabase/migrations/20261112004748_declutter_seller_notices_name_the_buyer.sql |     PERFORM public.declutter_notify_strict(r.buyer_id, 'payment', 'Check out within 24 hours',\n      CASE WHEN r.title IS NULL THEN 'You have an item waiting in your cart. |     PERFORM public.declutter_notify(r.buyer_id, 'payment', 'Check out within 24 hours',\n      CASE WHEN r.title IS NULL THEN 'You have an item waiting in your cart.
 * @mutate supabase/migrations/20261109224952_notices_card_fee_and_our_team.sql |         PERFORM public.declutter_notify_strict(r.seller_id, 'payment', 'Delivery coming up', |         PERFORM public.declutter_notify(r.seller_id, 'payment', 'Delivery coming up',
 * @mutate supabase/migrations/20261109224952_notices_card_fee_and_our_team.sql |         PERFORM public.declutter_notify_strict(r.buyer_id, 'payment', 'Delivery coming up', |         PERFORM public.declutter_notify(r.buyer_id, 'payment', 'Delivery coming up',
 * @mutate supabase/migrations/20261031181404_declutter_notices_name_the_item_sweep_remind_task.sql |   PERFORM public.declutter_notify_strict(p_user, 'declutter_pickups', p_title, p_message, p_link, p_other); |   PERFORM public.declutter_notify(p_user, 'declutter_pickups', p_title, p_message, p_link, p_other);
 * @mutate supabase/migrations/20261106194913_shops_helpr_delivery.sql |       RETURN public.declutter_delivery_still_in_hand(t.source_id, t.id); |       BEGIN PERFORM public.declutter_delivery_still_in_hand(t.source_id, t.id); EXCEPTION WHEN OTHERS THEN NULL; END; RETURN NULL;
 *
 * Re-read 2026-11-01 (builder 140, the item's other sweep lines): the held-sale nudge in declutter_handover_sweep and
 * helpr_task_sweep's still-in-hand nudge (BUY-37) send through declutter_pickup_remind, which is strict, inside the
 * row's own BEGIN/EXCEPTION block after the claim (held_nudged_at / in_hand_nudged_at), and nothing between swallows
 * the error, so a failed reminder rolls its claim back and is retried. Every other send left best-effort in these
 * sweeps reports a step that already happened (expired, cancelled, closed, held for an admin, stuck), not a reminder.
 */
import { describe, expect, it } from "vitest";
import { resolve } from "node:path";
import { effectiveDefs } from "./helpers/effectiveFunctionDefs";
import { blankSqlComments } from "./helpers/blankNonCode";

const defs = effectiveDefs(resolve(__dirname, "../../supabase/migrations"));
const flat = (s: string) => s.replace(/\s+/g, " ");
const body = (fn: string) => flat(blankSqlComments(defs.get(fn)?.stmt ?? ""));
const REMINDERS = ["'Choose a pickup within 24 hours'", "'Check out within 24 hours'", "'2 hours left to choose a pickup'", "'2 hours left to check out'"];

describe("reminders that cannot be written are retried, not marked sent", () => {
  const deadline = body("declutter_deadline_sweep");
  const handover = body("declutter_handover_sweep");

  it("reads the newest definitions", () => {
    expect(defs.size).toBeGreaterThan(500);
    expect(deadline.length).toBeGreaterThan(5000);
    expect(handover.length).toBeGreaterThan(5000);
  });

  it("every checkout reminder is sent strict, never best-effort", () => {
    for (const t of REMINDERS) {
      expect(deadline, t).toContain(`declutter_notify_strict(r.buyer_id, `);
      const sends = deadline.match(new RegExp(`declutter_notify(_strict)?\\(r\\.buyer_id, '[a-z_]+', ${t}`, "g")) ?? [];
      expect(sends.length, t).toBeGreaterThan(0);
      for (const s of sends) expect(s, t).toContain("declutter_notify_strict(");
    }
  });

  it("a failed reminder clears its own line's claim and is logged; the count follows the send", () => {
    expect(deadline).toContain("v_r24 := v_r24 + 1; EXCEPTION WHEN OTHERS THEN UPDATE public.declutter_cart_items SET reminded_24h_at = NULL WHERE id = r.id; PERFORM public.log_cron_defect('declutter_deadline_sweep', 'reminder_24h:' || r.id::text, SQLERRM);");
    expect(deadline).toContain("v_r2 := v_r2 + 1; EXCEPTION WHEN OTHERS THEN UPDATE public.declutter_cart_items SET reminded_2h_at = NULL WHERE id = r.id; PERFORM public.log_cron_defect('declutter_deadline_sweep', 'reminder_2h:' || r.id::text, SQLERRM);");
    expect(deadline.match(/RETURNING c\.id, c\.buyer_id, c\.price_cents, c\.source/g)?.length).toBe(2);
  });

  it("the delivery reminders are strict inside the order's block, after the reminded_hours mark", () => {
    const mark = handover.indexOf("SET reminded_hours = (SELECT array_agg(DISTINCT y ORDER BY y)");
    expect(mark).toBeGreaterThan(0);
    const seller = handover.indexOf("PERFORM public.declutter_notify_strict(r.seller_id, 'payment', 'Delivery coming up',");
    const buyer = handover.indexOf("PERFORM public.declutter_notify_strict(r.buyer_id, 'payment', 'Delivery coming up',");
    expect(seller).toBeGreaterThan(mark);
    expect(buyer).toBeGreaterThan(seller);
    expect(handover).not.toContain("declutter_notify(r.seller_id, 'payment', 'Delivery coming up'");
    expect(handover.indexOf("EXCEPTION WHEN OTHERS THEN", buyer)).toBeGreaterThan(buyer);
  });

  it("the held-sale and still-in-hand nudges are strict after their claim, and nothing swallows the error", () => {
    expect(body("declutter_pickup_remind")).toContain("PERFORM public.declutter_notify_strict(p_user, 'declutter_pickups', p_title, p_message, p_link, p_other);");
    const claim = handover.indexOf("UPDATE public.declutter_handovers SET held_nudged_at = now() WHERE order_id = o.id;");
    const nudge = handover.indexOf("PERFORM public.declutter_pickup_remind(o.buyer_id,", claim);
    expect(claim).toBeGreaterThan(0);
    expect(nudge).toBeGreaterThan(claim);
    expect(handover.slice(claim, nudge)).not.toMatch(/EXCEPTION\s+WHEN/);
    expect(handover.indexOf("EXCEPTION WHEN OTHERS THEN", nudge)).toBeGreaterThan(nudge);
    const sweep = body("helpr_task_sweep");
    const inHand = sweep.indexOf("UPDATE public.helpr_tasks SET in_hand_nudged_at = now() WHERE id = t.id;");
    const event = sweep.indexOf("PERFORM public.helpr_task_source_event(t.id, 'still_in_hand', NULL);", inHand);
    expect(inHand).toBeGreaterThan(0);
    expect(event).toBeGreaterThan(inHand);
    expect(sweep.indexOf("EXCEPTION WHEN OTHERS THEN", event)).toBeGreaterThan(event);
    const source = body("helpr_task_source_event");
    expect(source).toContain("RETURN public.declutter_delivery_still_in_hand(t.source_id, t.id);");
    expect(source).not.toMatch(/EXCEPTION\s+WHEN/);
    const still = body("declutter_delivery_still_in_hand");
    expect(still.match(/PERFORM public\.declutter_pickup_remind\(/g)?.length).toBe(3);
    expect(still).not.toMatch(/EXCEPTION\s+WHEN/);
  });
});
