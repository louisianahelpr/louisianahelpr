/**
 * Q2465 (lead 2026-11-01): pure reminder sends use declutter_notify_strict, so a reminder that cannot be written is
 * retried next run instead of being marked sent. declutter_deadline_sweep's 24-hour and 2-hour checkout reminders run
 * each line in its own block that clears the line's claim on failure; declutter_handover_sweep (d)'s "Delivery coming
 * up" sends sit in the order's own block, so a failure rolls the reminded_hours mark back with them. Reads the EFFECTIVE
 * definitions. Backend proof (deadline sweep): src/test/pglite/declutterRemindersRetryStrict.pglite.mjs.
 *
 * @mutate supabase/migrations/20261102031228_declutter_reminders_retry_strict.sql |     UPDATE public.declutter_cart_items SET reminded_24h_at = NULL WHERE id = r.id;\n |
 * @mutate supabase/migrations/20261102031228_declutter_reminders_retry_strict.sql |     UPDATE public.declutter_cart_items SET reminded_2h_at = NULL WHERE id = r.id;\n |
 * @mutate supabase/migrations/20261102031228_declutter_reminders_retry_strict.sql |     PERFORM public.declutter_notify_strict(r.buyer_id, 'payment', 'Check out within 24 hours',\n      CASE WHEN r.title IS NULL THEN 'You have an item waiting in your cart. |     PERFORM public.declutter_notify(r.buyer_id, 'payment', 'Check out within 24 hours',\n      CASE WHEN r.title IS NULL THEN 'You have an item waiting in your cart.
 * @mutate supabase/migrations/20261102031228_declutter_reminders_retry_strict.sql |         PERFORM public.declutter_notify_strict(r.seller_id, 'payment', 'Delivery coming up', |         PERFORM public.declutter_notify(r.seller_id, 'payment', 'Delivery coming up',
 * @mutate supabase/migrations/20261102031228_declutter_reminders_retry_strict.sql |         PERFORM public.declutter_notify_strict(r.buyer_id, 'payment', 'Delivery coming up', |         PERFORM public.declutter_notify(r.buyer_id, 'payment', 'Delivery coming up',
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
});
