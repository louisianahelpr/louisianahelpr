// @mutate supabase/migrations/20261101233256_declutter_manager_payout_kind.sql |     CHECK (payout_kind IN ('declutter', 'helpr_task', 'shop', 'declutter_refund', 'delivery_refund', 'declutter_manager')); |     CHECK (payout_kind IN ('declutter', 'helpr_task', 'shop', 'declutter_refund', 'delivery_refund'));
// @mutate supabase/migrations/20261101233256_declutter_manager_payout_kind.sql |   ELSIF p_kind = 'declutter_manager' THEN\n    UPDATE public.declutter_manager_payouts SET next_attempt_at | ELSIF false THEN\n    UPDATE public.declutter_manager_payouts SET next_attempt_at
// @mutate supabase/migrations/20261101233256_declutter_manager_payout_kind.sql | AND (mp.ban_status IN ('banned', 'temp_banned', 'permanently_banned') | AND (false
// @mutate supabase/migrations/20261101233256_declutter_manager_payout_kind.sql |      AND NOT EXISTS (SELECT 1 FROM public.payout_holds ph WHERE ph.helper_id = m.manager_id) |
// @mutate supabase/migrations/20261101233256_declutter_manager_payout_kind.sql | (p.items_cents - least(p_refunded_cents, p.items_cents)) | (p.items_cents + p.delivery_cents - p_refunded_cents)
// @mutate supabase/migrations/20261101233256_declutter_manager_payout_kind.sql | 'delivery_refund', 'declutter_manager') OR p_payout_id IS NULL | 'delivery_refund') OR p_payout_id IS NULL
// @mutate supabase/migrations/20261101234732_declutter_manager_payout_admin_held.sql |       SELECT 'declutter_manager', p.id, p.manager_id, p.amount_cents, p.review_reason, p.review_held_at, |       SELECT 'x', p.id, p.manager_id, p.amount_cents, p.review_reason, p.review_held_at,
// @mutate supabase/migrations/20261101234732_declutter_manager_payout_admin_held.sql |     UPDATE public.declutter_manager_payouts SET status = 'pending', next_attempt_at = now(), attempts = 0, review_reason = NULL, |     UPDATE public.declutter_manager_payouts SET status = status, next_attempt_at = now(), attempts = 0, review_reason = NULL,
// @mutate supabase/migrations/20261101234732_declutter_manager_payout_admin_held.sql |     UPDATE public.declutter_manager_payouts SET status = CASE WHEN v_succeeded THEN 'succeeded' ELSE 'settled_by_hand' END, |     UPDATE public.declutter_manager_payouts SET status = status,
// @mutate supabase/migrations/20261101234732_declutter_manager_payout_admin_held.sql |       ELSIF r.kind = 'declutter_manager' THEN UPDATE public.declutter_manager_payouts SET held_notified_at = now() WHERE id = r.id; |
//
// Declutter manager mode phase 2b, the SQL half (lead conditions a and b on 87b3df401b, 11-01). Reads the NEWEST
// definitions: the payout kind 'declutter_manager' is taken by the waits and send-mark tables and by every payout
// helper declutter-money calls for it (defer, wait seen, hold for review, prune); the manager's queue never offers a
// banned, suspended or held manager; a refund cuts the share by the items refund only. Behaviour:
// src/test/pglite/declutterManagerPayoutKind.pglite.mjs (15 checks; NEW_MIGRATION=skip and 6 planted defects go red).
import { describe, expect, it } from "vitest";
import { resolve } from "node:path";
import { readFileSync } from "node:fs";
import { readdirSync } from "./helpers/trackedFiles";
import { blankSqlComments } from "./helpers/blankNonCode";
import { effectiveDefs } from "./helpers/effectiveFunctionDefs";

const MIG = resolve(__dirname, "../../supabase/migrations");
const DEFS = effectiveDefs(MIG);
const body = (n: string) => blankSqlComments(DEFS.get(n)?.stmt ?? "").replace(/\s+/g, " ");
const FILES = readdirSync(MIG).filter((n) => n.endsWith(".sql")).sort();

/** The newest ADD CONSTRAINT <name> CHECK (...) text, comments blanked. */
function newestCheck(name: string): string {
  let last = "";
  for (const f of FILES) {
    const sql = blankSqlComments(readFileSync(resolve(MIG, f), "utf8")).replace(/\s+/g, " ");
    for (const m of sql.matchAll(new RegExp(`ADD CONSTRAINT ${name} CHECK \\(([^;]*)\\);`, "g"))) last = m[1];
  }
  return last;
}

describe("Declutter manager mode: the manager payout kind", () => {
  it("the lead's condition on 266e149865: the admin money page lists, releases and settles a held manager row", () => {
    expect(body("admin_payouts_held_for_review")).toContain("SELECT 'declutter_manager', p.id, p.manager_id, p.amount_cents, p.review_reason, p.review_held_at, 'declutter_order_' || p.order_id::text FROM public.declutter_manager_payouts p WHERE p.status = 'held_for_review'");
    expect(body("admin_payout_release")).toContain("ELSIF p_kind = 'declutter_manager' THEN UPDATE public.declutter_manager_payouts SET status = 'pending', next_attempt_at = now(), attempts = 0");
    expect(body("admin_payout_settle_by_hand")).toContain("ELSIF p_kind = 'declutter_manager' THEN UPDATE public.declutter_manager_payouts SET status = CASE WHEN v_succeeded THEN 'succeeded' ELSE 'settled_by_hand' END");
    expect(body("admin_payout_settle_by_hand")).toContain("v_payout boolean := p_kind IN ('declutter', 'helpr_task', 'shop', 'declutter_manager');");
    const check = body("payout_held_check");
    expect(check).toContain("FROM public.declutter_manager_payouts p WHERE p.status = 'held_for_review'");
    expect(check).toContain("ELSIF r.kind = 'declutter_manager' THEN UPDATE public.declutter_manager_payouts SET held_notified_at = now() WHERE id = r.id;");
    expect(newestCheck("payout_settlements_row_kind_check")).toContain("'declutter_manager'");
    expect(newestCheck("declutter_manager_payouts_status_check")).toContain("'settled_by_hand'");
  });

  it("reads the real definitions", () => {
    expect(DEFS.size).toBeGreaterThan(500);
    expect(FILES.length).toBeGreaterThan(500);
    for (const n of ["payout_defer", "payout_hold_for_review", "payout_payee_wait_seen", "payout_payee_waits_prune",
      "declutter_rebook_payout", "declutter_manager_payouts_due"]) {
      expect(body(n).length, n).toBeGreaterThan(200);
    }
  });

  it("the waits and send-mark tables take the manager kind", () => {
    expect(newestCheck("payout_payee_waits_payout_kind_check")).toContain("'declutter_manager'");
    expect(newestCheck("payout_send_marks_payout_kind_check")).toContain("'declutter_manager'");
    expect(newestCheck("declutter_manager_payouts_status_check")).toContain("'held_for_review'");
  });

  it("every payout helper declutter-money calls dispatches the manager kind", () => {
    expect(body("payout_defer")).toContain("ELSIF p_kind = 'declutter_manager' THEN UPDATE public.declutter_manager_payouts SET next_attempt_at = v_until");
    expect(body("payout_hold_for_review")).toContain("ELSIF p_kind = 'declutter_manager' THEN UPDATE public.declutter_manager_payouts SET status = 'held_for_review'");
    expect(body("payout_payee_wait_seen")).toContain("'delivery_refund', 'declutter_manager') OR p_payout_id IS NULL");
    expect(body("payout_payee_waits_prune")).toContain("w.payout_kind = 'declutter_manager'");
    expect(body("payout_payee_waits_prune")).toContain("m.payout_kind = 'declutter_manager' AND p.id = m.payout_id AND p.status IN ('pending', 'failed', 'held_for_review')");
  });

  it("lead condition a: the queue never offers a banned, suspended or held manager", () => {
    const b = body("declutter_manager_payouts_due");
    expect(b).toContain("mp.user_id = m.manager_id AND (mp.ban_status IN ('banned', 'temp_banned', 'permanently_banned') OR mp.auto_suspended_until > now())");
    expect(b).toContain("AND NOT EXISTS (SELECT 1 FROM public.payout_holds ph WHERE ph.helper_id = m.manager_id)");
  });

  it("lead condition b: the share is cut by the items refund only", () => {
    const b = body("declutter_rebook_payout");
    expect(b).toContain("floor(v_m.share_cents::numeric * (p.items_cents - least(p_refunded_cents, p.items_cents)) / p.items_cents)::integer");
    expect(b).not.toContain("(p.items_cents + p.delivery_cents - p_refunded_cents) / (p.items_cents + p.delivery_cents)");
  });
});
