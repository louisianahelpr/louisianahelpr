/**
 * Declutter slice 4 (20261015042253_declutter_slice4_handover_payout; owner rows
 * 14-15, 18-19, 22, 25-28, 45, 52, 62, 67, 93-98 and build decisions B49-B58 in
 * docs/specs/declutter-auctions.md). The fast half of the proof, read from the
 * NEWEST definitions the migrations leave (effectiveDefs), so a later
 * restatement that drops a lock, a gate or a money rule fails here.
 *
 * Behaviour (127 checks, 3x replay, slice 4 skipped = RED, 10
 * planted defects each caught, measured 2026-10-15):
 * src/test/pglite/declutterSlice4.pglite.mjs. Concurrency (scan vs "I got it"
 * vs auto-pay vs problem vs no-show; two real sessions): scripts/declutter/race-handover.mjs.
 *
 * @mutate supabase/migrations/20261015042253_declutter_slice4_handover_payout.sql | 'invalid_method' USING ERRCODE = '22023';\n  END IF;\n  o := public.declutter_lock_order(p_order_id); | 'invalid_method' USING ERRCODE = '22023';\n  END IF;\n  SELECT * INTO o FROM public.declutter_orders WHERE id = p_order_id;
 * @mutate supabase/migrations/20261015042253_declutter_slice4_handover_payout.sql |   order_id uuid NOT NULL UNIQUE REFERENCES public.declutter_orders(id) ON DELETE RESTRICT, |   order_id uuid NOT NULL REFERENCES public.declutter_orders(id) ON DELETE RESTRICT,
 * @mutate supabase/migrations/20261015042253_declutter_slice4_handover_payout.sql | IF p_by <> 'admin' AND EXISTS (SELECT 1 FROM public.declutter_problems p WHERE p.order_id = o.id AND p.status = 'open') THEN | IF false THEN
 * @mutate supabase/migrations/20261015042253_declutter_slice4_handover_payout.sql |   v_debt := public.declutter_consume_fee_debt(o.seller_id, 'declutter_order_' \|\| o.id::text, o.items_cents); |   v_debt := 0;
 * @mutate supabase/migrations/20261015042253_declutter_slice4_handover_payout.sql |                       WHEN reason IN ('buyer_no_show', 'admin_buyer_fault') THEN 'keep_buyer_fee' |                       WHEN reason IN ('buyer_no_show', 'admin_buyer_fault') THEN 'keep_card_fee'
 * @mutate supabase/migrations/20261017045215_declutter_seller_out_pays_fee.sql |     v_kept := v_order.premium_cents; |     v_kept := 1;
 * @mutate supabase/migrations/20261015042253_declutter_slice4_handover_payout.sql |     'code', CASE WHEN v_side = 'buyer' AND o.status = 'paid' THEN h.code END, |     'code', CASE WHEN o.status = 'paid' THEN h.code END,
 * @mutate supabase/migrations/20261015042253_declutter_slice4_handover_payout.sql |   v_from := b.slot_start + interval '15 minutes'; |   v_from := b.slot_start;
 * @mutate supabase/migrations/20261015051301_declutter_shared_star_rating.sql |     SELECT t.user_id, dr.stars::integer, false | SELECT t.user_id, dr.stars::integer, true
 * @mutate supabase/migrations/20261017054625_declutter_handover_private_bucket.sql |   v_done := public.declutter_complete_handover(o.id, 'porch'); |   v_done := '{}'::jsonb;
 * @mutate supabase/migrations/20261015042253_declutter_slice4_handover_payout.sql | REVOKE ALL ON FUNCTION public.declutter_complete_handover(uuid, text) FROM PUBLIC, anon, authenticated; | REVOKE ALL ON FUNCTION public.declutter_complete_handover(uuid, text) FROM PUBLIC, anon;
 * @mutate supabase/migrations/20261015042253_declutter_slice4_handover_payout.sql | REVOKE ALL ON TABLE public.declutter_handovers FROM PUBLIC, anon, authenticated;\nGRANT ALL ON TABLE public.declutter_handovers TO service_role; | REVOKE ALL ON TABLE public.declutter_handovers FROM PUBLIC, anon;\nGRANT ALL ON TABLE public.declutter_handovers TO service_role, authenticated;
 * @mutate supabase/migrations/20261017054625_declutter_handover_private_bucket.sql |   IF public.is_caller_banned() THEN\n    RAISE EXCEPTION 'account_restricted' USING ERRCODE = '42501';\n  END IF;\n  o := public.declutter_lock_order(p_order_id);\n  v_side := public.declutter_order_side(o.buyer_id, o.seller_id, v_uid);\n  IF v_side IS NULL THEN\n    RAISE EXCEPTION 'item_not_found' USING ERRCODE = 'P0002';\n  END IF;\n  IF o.status = 'handed_over' THEN\n    RAISE EXCEPTION 'sale_final' |   o := public.declutter_lock_order(p_order_id);\n  v_side := public.declutter_order_side(o.buyer_id, o.seller_id, v_uid);\n  IF v_side IS NULL THEN\n    RAISE EXCEPTION 'item_not_found' USING ERRCODE = 'P0002';\n  END IF;\n  IF o.status = 'handed_over' THEN\n    RAISE EXCEPTION 'sale_final'
 * @mutate supabase/migrations/20261017054624_declutter_refund_hand_settle.sql |    WHERE id = p_refund_id AND stripe_refund_ref = p_stripe_refund_id AND status = 'succeeded'\n  RETURNING attempts INTO v_attempts; |    WHERE id = p_refund_id AND status = 'succeeded'\n  RETURNING attempts INTO v_attempts;
 * @mutate supabase/migrations/20261017054624_declutter_refund_hand_settle.sql |   RETURN CASE WHEN v_attempts >= 12 THEN 'gave_up' ELSE 'reopened' END; |   RETURN 'reopened';
 * @mutate supabase/migrations/20261015042253_declutter_slice4_handover_payout.sql |   UPDATE public.declutter_refunds SET payment_livemode = p_livemode WHERE id = p_refund_id AND payment_livemode IS NULL; |   UPDATE public.declutter_refunds SET payment_livemode = p_livemode WHERE id = p_refund_id;
 * @mutate supabase/migrations/20261017054625_declutter_handover_private_bucket.sql |   SELECT min(round(2 * 6371000 | SELECT max(round(2 * 6371000
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { blankSqlComments } from "./helpers/blankNonCode";
import { effectiveDefs } from "./helpers/effectiveFunctionDefs";

const MIG_DIR = join(process.cwd(), "supabase/migrations");
const FILE = "20261015042253_declutter_slice4_handover_payout.sql";
const MIG = blankSqlComments(readFileSync(join(MIG_DIR, FILE), "utf8"));
const DEFS = effectiveDefs(MIG_DIR);
const body = (name: string) => blankSqlComments(DEFS.get(name)?.stmt ?? "");
const flat = (s: string) => s.replace(/\s+/g, " ");

/** Member RPCs that change something: banned callers refused, no switch needed (row 62), order locked. */
const MEMBER_WRITES = [
  "declutter_book_pickup", "declutter_set_porch_time", "declutter_confirm_handover", "declutter_porch_photo",
  "declutter_report_no_show", "declutter_report_problem",
];
const MEMBER_OTHER = ["declutter_my_handover", "declutter_leave_review", "declutter_visible_reviews", "declutter_admin_decide_problem"];
const SERVICE_ONLY = [
  "declutter_lock_order", "declutter_new_handover_code", "declutter_complete_handover", "declutter_close_paid_order",
  "declutter_slot_in_windows", "declutter_order_side", "declutter_in_agreed_sale", "declutter_handover_sweep",
  "declutter_payouts_due", "declutter_payout_executed", "declutter_refunds_due", "declutter_order_rows_seed",
  "declutter_refund_set_mode", "declutter_refund_reversed",
];

describe("Declutter slice 4: handover, payout once, problems, no-shows (20261015042253)", () => {
  it("reads a real inventory (floors)", () => {
    for (const fn of [...MEMBER_WRITES, ...MEMBER_OTHER, ...SERVICE_ONLY]) expect(body(fn), fn).not.toBe("");
    expect(MEMBER_WRITES.length + MEMBER_OTHER.length + SERVICE_ONLY.length).toBeGreaterThan(20);
    expect(MIG.length).toBeGreaterThan(30_000);
  });

  it("B50: every path out of 'paid' locks the order first (items, then order) and re-checks its status", () => {
    expect(flat(body("declutter_lock_order"))).toContain("ORDER BY i.id FOR UPDATE; SELECT * INTO o FROM public.declutter_orders WHERE id = p_order_id FOR UPDATE;");
    for (const fn of MEMBER_WRITES) expect(flat(body(fn)), fn).toContain("o := public.declutter_lock_order(p_order_id);");
    expect(flat(body("declutter_admin_decide_problem"))).toContain("o := public.declutter_lock_order(v_order);");
    expect(flat(body("declutter_handover_sweep"))).toContain("o := public.declutter_lock_order(r.id);");
    expect(flat(body("declutter_complete_handover"))).toContain("IF o.status IS DISTINCT FROM 'paid' THEN RAISE EXCEPTION 'order_not_paid'");
    expect(flat(body("declutter_close_paid_order"))).toContain("IF o.status IS DISTINCT FROM 'paid' OR o.stripe_payment_intent_id IS NULL THEN RAISE EXCEPTION 'order_not_paid'");
    expect(flat(body("declutter_close_paid_order"))).toContain("RAISE EXCEPTION 'already_paid_out'");
  });

  it("rows 22, 93, B43, B53: one payout per order, ever, with the seller's card-fee debt taken out", () => {
    expect(flat(MIG)).toContain("order_id uuid NOT NULL UNIQUE REFERENCES public.declutter_orders(id) ON DELETE RESTRICT,");
    expect(flat(MIG)).toContain("CONSTRAINT declutter_payouts_amount CHECK (amount_cents = items_cents - debt_cents AND amount_cents >= 0)");
    const done = flat(body("declutter_complete_handover"));
    expect(done).toContain("v_debt := public.declutter_consume_fee_debt(o.seller_id, 'declutter_order_' || o.id::text, o.items_cents);");
    expect(done).toContain("ON CONFLICT (order_id) DO NOTHING");
  });

  it("rows 67, 96: an open problem holds the handover, the auto-pay and the payout; after payment the sale is final", () => {
    expect(flat(body("declutter_complete_handover"))).toContain("IF p_by <> 'admin' AND EXISTS (SELECT 1 FROM public.declutter_problems p WHERE p.order_id = o.id AND p.status = 'open') THEN");
    expect(flat(body("declutter_payouts_due"))).toContain("AND NOT EXISTS (SELECT 1 FROM public.declutter_problems x WHERE x.order_id = p.order_id AND x.status = 'open')");
    expect(flat(body("declutter_report_problem"))).toContain("IF o.status = 'handed_over' THEN RAISE EXCEPTION 'sale_final'");
    expect(flat(MIG)).toContain("CREATE UNIQUE INDEX IF NOT EXISTS declutter_problems_one_open ON public.declutter_problems (order_id) WHERE status = 'open';");
  });

  it("row 95 (owner, 2026-10-15): a buyer no-show refunds EXACTLY the item price; the reason fixes the policy", () => {
    expect(flat(MIG)).toContain("WHEN reason IN ('buyer_no_show', 'admin_buyer_fault') THEN 'keep_buyer_fee'");
    expect(flat(MIG)).toContain("WHEN fee_policy = 'keep_buyer_fee' THEN paid_cents - kept_cents");
    expect(flat(body("declutter_record_refund"))).toContain("v_kept := v_order.premium_cents;");
    expect(flat(body("declutter_record_refund"))).toContain("WHEN p_reason IN ('seller_backed_out', 'seller_out', 'seller_no_show', 'not_as_described') THEN 'full_seller_pays_fee'");
  });

  it("row 25, B52: the code is the buyer's alone; wrong codes are counted (returned, not raised) and lock at 5", () => {
    expect(flat(body("declutter_my_handover"))).toContain("'code', CASE WHEN v_side = 'buyer' AND o.status = 'paid' THEN h.code END,");
    expect(flat(MIG)).toContain("REVOKE ALL ON TABLE public.declutter_handovers FROM PUBLIC, anon, authenticated; GRANT ALL ON TABLE public.declutter_handovers TO service_role;");
    const c = flat(body("declutter_confirm_handover"));
    expect(c).toContain("RETURN jsonb_build_object('result', 'wrong_code', 'attempts_left', 4 - h.wrong_attempts);");
    expect(c).toContain("IF h.wrong_attempts >= 5 THEN RETURN jsonb_build_object('result', 'code_locked');");
    expect(c).toContain("IF (p_method = 'buyer') <> (v_side = 'buyer') THEN");
  });

  it("row 99 (owner, 2026-10-15): the buyer's porch \"Picked up\" photo pays the seller right away unless a problem is open", () => {
    const p = flat(body("declutter_porch_photo"));
    expect(p).toContain("v_done := public.declutter_complete_handover(o.id, 'porch');");
    expect(p).toContain("IF EXISTS (SELECT 1 FROM public.declutter_problems p WHERE p.order_id = o.id AND p.status = 'open') THEN");
    expect(flat(MIG)).toContain("confirmed_by IN ('scan', 'code', 'buyer', 'porch', 'auto', 'admin')");
  });

  it("row 45 (lead 2026-10-15): ONE public star rating across job and Declutter reviews, public ones only", () => {
    const st = flat(body("get_public_profile_stats"));
    expect(DEFS.get("get_public_profile_stats")?.file).toBe("20261015051301_declutter_shared_star_rating.sql");
    expect(st).toContain("JOIN public.declutter_reviews dr ON dr.reviewee_id = t.user_id");
    expect(st).toContain("WHERE o.status = 'handed_over' AND (o.handed_over_at <= now() - interval '14 days' OR (SELECT count(*) FROM public.declutter_reviews d2 WHERE d2.order_id = dr.order_id) = 2)");
    expect(st).toContain("SELECT t.user_id, dr.stars::integer, false");
  });

  it("row 94: \"They didn't show\" opens 15 minutes after the booked time; the auto-pay waits 24 h", () => {
    expect(flat(body("declutter_report_no_show"))).toContain("v_from := b.slot_start + interval '15 minutes';");
    expect(flat(body("declutter_handover_sweep"))).toContain("b.slot_start + interval '24 hours' <= now()");
    expect(MIG).toContain("cron.schedule('declutter-handovers'");
    expect(MIG).toContain("('declutter-handovers', interval");
  });

  it("review notes 2026-10-15: CSPRNG code, nearest item's pickup point, refund mode set once, only the recorded refund reopens", () => {
    expect(flat(body("declutter_new_handover_code"))).toContain("gen_random_uuid()");
    expect(body("declutter_new_handover_code")).not.toMatch(/(^|[^_])random\(\)/);
    expect(flat(body("declutter_porch_photo"))).toContain("WHERE c.order_id = o.id AND p.pickup_lat IS NOT NULL AND p.pickup_lng IS NOT NULL;");
    expect(flat(body("declutter_porch_photo"))).toMatch(/SELECT min\(round\(2 \* 6371000/);
    expect(flat(body("declutter_refund_set_mode"))).toContain("WHERE id = p_refund_id AND payment_livemode IS NULL;");
    expect(flat(body("declutter_refund_reversed"))).toContain("WHERE id = p_refund_id AND stripe_refund_ref = p_stripe_refund_id AND status = 'succeeded' RETURNING attempts INTO v_attempts;");
    expect(flat(body("declutter_refunds_due"))).toContain("r.payment_livemode");
    // Re-review should-fixes 1 and 3: a reversal at the 12-try cap gives up (same cap as the queue); the queue hands
    // declutter-money the order's Checkout Session id.
    expect(flat(body("declutter_refund_reversed"))).toContain("RETURN CASE WHEN v_attempts >= 12 THEN 'gave_up' ELSE 'reopened' END;");
    expect(flat(body("declutter_refunds_due"))).toContain("AND r.attempts < 12");
    expect(flat(body("declutter_refunds_due"))).toContain("o.stripe_checkout_session_id");
  });

  it("member writes refuse banned callers and never need the switch (row 62); internals are service-only", () => {
    for (const fn of MEMBER_WRITES) {
      expect(body(fn), fn).toMatch(/public\.is_caller_banned\(\)/);
      expect(body(fn), fn).not.toMatch(/require_feature/);
      expect(MIG, fn).toMatch(new RegExp(`REVOKE ALL ON FUNCTION public\\.${fn}\\([^)]*\\) FROM PUBLIC, anon;`));
    }
    for (const fn of ["declutter_leave_review", "declutter_admin_decide_problem"]) expect(body(fn), fn).toMatch(/public\.is_caller_banned\(\)/);
    expect(flat(body("declutter_admin_decide_problem"))).toContain("IF v_uid IS NULL OR NOT public.has_role(v_uid, 'admin') THEN");
    for (const fn of SERVICE_ONLY) {
      expect(MIG, fn).toMatch(new RegExp(`REVOKE ALL ON FUNCTION public\\.${fn}\\([^)]*\\) FROM PUBLIC, anon, authenticated;`));
      expect(MIG, fn).not.toMatch(new RegExp(`GRANT EXECUTE ON FUNCTION public\\.${fn}\\([^)]*\\) TO [^;]*authenticated`));
    }
  });
});
