// @mutate supabase/migrations/20261101230509_declutter_manager_share_split.sql |   v_debt := public.declutter_consume_fee_debt(o.seller_id, 'declutter_order_' \|\| o.id::text, o.items_cents + v_rate - v_share); |   v_debt := public.declutter_consume_fee_debt(o.seller_id, 'declutter_order_' \|\| o.id::text, o.items_cents + v_rate);
// @mutate supabase/migrations/20261101230509_declutter_manager_share_split.sql |                         o.items_cents)::integer |                         1000000000)::integer
// @mutate supabase/migrations/20261101230509_declutter_manager_share_split.sql |   IF NEW.status = 'paid' AND OLD.status IS DISTINCT FROM 'paid' AND NEW.paid_with IS DISTINCT FROM 'free' THEN |   IF NEW.status = 'paid' THEN
// @mutate supabase/migrations/20261101233256_declutter_manager_payout_kind.sql |        SET amount_cents = v_share, status = CASE WHEN v_share = 0 THEN 'nothing_due' ELSE 'pending' END, |        SET amount_cents = amount_cents, status = status,
// @mutate supabase/migrations/20261101233256_declutter_manager_payout_kind.sql |      AND sp.status IN ('pending', 'failed', 'succeeded', 'nothing_due') AND sp.review_held_at IS NULL |      AND sp.status IN ('pending', 'failed', 'succeeded', 'nothing_due')
// @mutate supabase/migrations/20261101230509_declutter_manager_share_split.sql |                        AND (m.status NOT IN ('pending', 'nothing_due') OR m.stripe_transfer_id IS NOT NULL OR m.attempts > 0 |                        AND (false
//
// Declutter manager mode phase 2, the money split (owner 11-01; lead plan + additions 11-01). Reads the NEWEST
// definitions: the share comes off before the seller's fee debt, a flat share is capped at the items, the share is
// fixed once at payment (never re-locked by a second 'paid' write), a refund cuts the manager's row in proportion,
// declutter_payout_unsent counts the manager's send, the manager's queue waits on the seller's row's own gates, and
// only the service role runs the money functions. Behaviour: src/test/pglite/declutterManagerShareSplit.pglite.mjs
// (20 checks; NEW_MIGRATION=skip and 5 planted defects go red).
import { describe, expect, it } from "vitest";
import { resolve } from "node:path";
import { readFileSync } from "node:fs";
import { readdirSync } from "./helpers/trackedFiles";
import { blankSqlComments } from "./helpers/blankNonCode";
import { effectiveDefs } from "./helpers/effectiveFunctionDefs";

const MIG = resolve(__dirname, "../../supabase/migrations");
const DEFS = effectiveDefs(MIG);
const body = (n: string) => blankSqlComments(DEFS.get(n)?.stmt ?? "").replace(/\s+/g, " ");

/** Whether `role` may EXECUTE public.<fn> after every migration (explicit grant needed). */
function mayRun(fn: string, role: string): boolean {
  let may = false;
  for (const f of readdirSync(MIG).filter((n) => n.endsWith(".sql")).sort()) {
    const sql = blankSqlComments(readFileSync(resolve(MIG, f), "utf8"));
    for (const m of sql.matchAll(new RegExp(`\\b(REVOKE|GRANT)\\b[^;]*ON FUNCTION public\\.${fn}\\s*\\([^;]*;`, "g"))) {
      if (new RegExp(`\\b${role}\\b`).test(m[0])) may = m[0].startsWith("GRANT");
    }
  }
  return may;
}

describe("Declutter manager mode: the money split", () => {
  it("reads the real definitions", () => {
    expect(DEFS.size).toBeGreaterThan(500);
    for (const n of ["declutter_complete_handover", "declutter_rebook_payout", "declutter_payout_unsent", "declutter_manager_share_cents",
      "declutter_lock_manager_share", "declutter_manager_payouts_due", "declutter_manager_payout_executed"]) {
      expect(body(n).length, n).toBeGreaterThan(200);
    }
  });

  it("the handover takes the share first, then the debt from what is left, and writes the manager's own row", () => {
    const b = body("declutter_complete_handover");
    expect(b).toContain("v_share := public.declutter_manager_share_cents(o.id);");
    expect(b).toContain("public.declutter_consume_fee_debt(o.seller_id, 'declutter_order_' || o.id::text, o.items_cents + v_rate - v_share);");
    expect(b).toContain("o.items_cents + v_rate - v_share - v_debt");
    expect(b).toContain("INSERT INTO public.declutter_manager_payouts");
  });

  it("a flat share is capped at the items; the share is fixed once, at payment", () => {
    expect(body("declutter_manager_share_cents")).toMatch(/least\(s\.share_cents::bigint \* \(.*\), o\.items_cents\)::integer/);
    expect(body("declutter_lock_manager_share")).toContain("IF NEW.status = 'paid' AND OLD.status IS DISTINCT FROM 'paid' AND NEW.paid_with IS DISTINCT FROM 'free' THEN");
    expect(body("declutter_lock_manager_share")).toContain("ON CONFLICT (order_id) DO NOTHING");
  });

  it("a refund cuts the manager's row in proportion, and nothing is rebooked once either send may have started", () => {
    const b = body("declutter_rebook_payout");
    expect(b).toContain("SET amount_cents = v_share, status = CASE WHEN v_share = 0 THEN 'nothing_due' ELSE 'pending' END,");
    expect(b.indexOf("declutter_payout_unsent(p_order_id)")).toBeGreaterThan(0);
    expect(body("declutter_payout_unsent")).toContain("FROM public.declutter_manager_payouts m WHERE m.order_id = p_order_id AND (m.status NOT IN ('pending', 'nothing_due') OR m.stripe_transfer_id IS NOT NULL OR m.attempts > 0");
  });

  it("the manager's queue waits on the seller's row's gates and on no block between them", () => {
    const b = body("declutter_manager_payouts_due");
    expect(b).toContain("AND sp.status IN ('pending', 'failed', 'succeeded', 'nothing_due') AND sp.review_held_at IS NULL");
    expect(b).toContain("public.declutter_sale_final(m.order_id)");
    expect(b).toContain("x.status = 'open'");
    expect(b).toContain("FROM public.user_blocks b");
  });

  it("only the service role runs the money functions", () => {
    for (const fn of ["declutter_manager_payouts_due", "declutter_manager_payout_executed", "declutter_manager_share_cents",
      "declutter_complete_handover", "declutter_rebook_payout", "declutter_payout_unsent"]) {
      expect(mayRun(fn, "authenticated"), fn).toBe(false);
      expect(mayRun(fn, "service_role"), fn).toBe(true);
    }
  });
});
