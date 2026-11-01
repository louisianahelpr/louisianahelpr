/**
 * Declutter slice 4 (20261015042253_declutter_slice4_handover_payout; owner rows
 * 14-15, 18-19, 22, 25-28, 45, 52, 62, 67, 93-98 and build decisions B49-B58 in
 * docs/specs/declutter-auctions.md). The fast half of the proof, read from the
 * NEWEST definitions the migrations leave (effectiveDefs), so a later
 * restatement that drops a lock, a gate or a money rule fails here.
 *
 * Behaviour (127 checks, 3x replay, slice 4 skipped = RED, 10
 * planted defects each caught, measured 2026-10-15):
 * src/test/pglite/declutterSlice4.pglite.mjs. Concurrency (typed code vs "I got it"
 * vs auto-pay vs problem vs no-show; two real sessions; the typed code is gone since 20261018183715): scripts/declutter/race-handover.mjs.
 *
 * @mutate supabase/migrations/20261031004529_declutter_handover_both_confirm.sql | 'invalid_method' USING ERRCODE = '22023';\n  END IF;\n  o := public.declutter_lock_order(p_order_id); | 'invalid_method' USING ERRCODE = '22023';\n  END IF;\n  SELECT * INTO o FROM public.declutter_orders WHERE id = p_order_id;
 * @mutate supabase/migrations/20261031004529_declutter_handover_both_confirm.sql |     'order_id', o.id, 'status', o.status, 'side', v_side,\n    'confirmed_by' |     'order_id', o.id, 'status', o.status, 'side', v_side,\n    'code', h.code, 'confirmed_by'
 * @mutate supabase/migrations/20261031004529_declutter_handover_both_confirm.sql |   IF p_method IS NULL OR p_method <> 'buyer' THEN |   IF p_method IS NULL OR p_method NOT IN ('code', 'buyer') THEN
 * @mutate supabase/migrations/20261031004529_declutter_handover_both_confirm.sql |   IF v_side <> 'buyer' THEN\n    -- the seller cannot tap | IF false THEN\n    -- the seller cannot tap
 * @mutate supabase/migrations/20261018183715_declutter_handover_no_qr_no_code.sql |   CHECK (confirmed_by IS NULL OR confirmed_by IN ('code', 'buyer', 'seller', 'porch', 'auto', 'admin')); |   CHECK (confirmed_by IS NULL OR confirmed_by IN ('scan', 'code', 'buyer', 'porch', 'auto', 'admin'));
 * @mutate supabase/migrations/20261031004529_declutter_handover_both_confirm.sql |   IF o.handover NOT IN ('pickup_home', 'meetup') THEN\n    RAISE EXCEPTION 'not_a_door_pickup' | IF false THEN\n    RAISE EXCEPTION 'not_a_door_pickup'
 * @mutate supabase/migrations/20261031181404_declutter_notices_name_the_item_sweep_remind_task.sql |          AND (o.handover <> 'porch' OR EXISTS (SELECT 1 FROM public.declutter_handovers h\n                                                WHERE h.order_id = o.id AND h.set_out_photo_path IS NOT NULL\n                                                  AND h.set_out_at + interval '24 hours' <= now())) THEN |          THEN
 * @mutate supabase/migrations/20261018183715_declutter_handover_no_qr_no_code.sql |   IF NEW.confirmed_by = 'code' AND | IF false AND
 * @mutate supabase/migrations/20261031231150_helpr_delivery_cant_finish.sql |   IF p_by IS NULL OR p_by NOT IN ('customer', 'auto', 'admin') THEN |   IF p_by IS NULL OR p_by NOT IN ('code', 'customer', 'auto', 'admin') THEN
 * @mutate supabase/migrations/20261031004529_declutter_handover_both_confirm.sql |   IF EXISTS (SELECT 1 FROM public.declutter_bookings b WHERE b.order_id = o.id AND b.slot_start > now()) THEN | IF false THEN
 * @mutate supabase/migrations/20261031170803_declutter_no_helpr_notice_offers_refund.sql | They leave it at your door with a photo; | Have your 4-digit code ready;
 * @mutate supabase/migrations/20261015042253_declutter_slice4_handover_payout.sql |   order_id uuid NOT NULL UNIQUE REFERENCES public.declutter_orders(id) ON DELETE RESTRICT, |   order_id uuid NOT NULL REFERENCES public.declutter_orders(id) ON DELETE RESTRICT,
 * @mutate supabase/migrations/20261031231150_helpr_delivery_cant_finish.sql | IF p_by <> 'admin' AND EXISTS (SELECT 1 FROM public.declutter_problems p WHERE p.order_id = o.id AND p.status = 'open') THEN | IF false THEN
 * @mutate supabase/migrations/20261031231150_helpr_delivery_cant_finish.sql |   v_debt := public.declutter_consume_fee_debt(o.seller_id, 'declutter_order_' \|\| o.id::text, o.items_cents + v_rate); |   v_debt := 0;
 * @mutate supabase/migrations/20261015042253_declutter_slice4_handover_payout.sql |                       WHEN reason IN ('buyer_no_show', 'admin_buyer_fault') THEN 'keep_buyer_fee' |                       WHEN reason IN ('buyer_no_show', 'admin_buyer_fault') THEN 'keep_card_fee'
 * @mutate supabase/migrations/20261031231150_helpr_delivery_cant_finish.sql |     v_kept := v_order.premium_cents; |     v_kept := 1;
 * @mutate supabase/migrations/20261031004529_declutter_handover_both_confirm.sql |                  ELSE b.slot_start + interval '15 minutes' END; |                  ELSE b.slot_start END;
 * @mutate supabase/migrations/20261030015205_test_data_never_counts.sql |     SELECT t.user_id, dr.stars::integer, false | SELECT t.user_id, dr.stars::integer, true
 * @mutate supabase/migrations/20261030164712_declutter_porch_places.sql |   v_done := public.declutter_complete_handover(o.id, 'porch'); |   v_done := '{}'::jsonb;
 * @mutate supabase/migrations/20261015042253_declutter_slice4_handover_payout.sql | REVOKE ALL ON FUNCTION public.declutter_complete_handover(uuid, text) FROM PUBLIC, anon, authenticated; | REVOKE ALL ON FUNCTION public.declutter_complete_handover(uuid, text) FROM PUBLIC, anon;
 * @mutate supabase/migrations/20261015042253_declutter_slice4_handover_payout.sql | REVOKE ALL ON TABLE public.declutter_handovers FROM PUBLIC, anon, authenticated;\nGRANT ALL ON TABLE public.declutter_handovers TO service_role; | REVOKE ALL ON TABLE public.declutter_handovers FROM PUBLIC, anon;\nGRANT ALL ON TABLE public.declutter_handovers TO service_role, authenticated;
 * @mutate supabase/migrations/20261031100935_declutter_problem_notices_name_the_item.sql |   IF public.is_caller_banned() THEN\n    RAISE EXCEPTION 'account_restricted' USING ERRCODE = '42501';\n  END IF;\n  o := public.declutter_lock_order(p_order_id);\n  v_side := public.declutter_order_side(o.buyer_id, o.seller_id, v_uid);\n  IF v_side IS NULL THEN\n    RAISE EXCEPTION 'item_not_found' USING ERRCODE = 'P0002';\n  END IF;\n  IF o.status = 'handed_over' THEN\n    -- 141d |   o := public.declutter_lock_order(p_order_id);\n  v_side := public.declutter_order_side(o.buyer_id, o.seller_id, v_uid);\n  IF v_side IS NULL THEN\n    RAISE EXCEPTION 'item_not_found' USING ERRCODE = 'P0002';\n  END IF;\n  IF o.status = 'handed_over' THEN\n    -- 141d
 * @mutate supabase/migrations/20261017055500_declutter_refund_hand_settle.sql |    WHERE id = p_refund_id AND stripe_refund_ref = p_stripe_refund_id AND status = 'succeeded'\n  RETURNING attempts INTO v_attempts; |    WHERE id = p_refund_id AND status = 'succeeded'\n  RETURNING attempts INTO v_attempts;
 * @mutate supabase/migrations/20261017055500_declutter_refund_hand_settle.sql |   RETURN CASE WHEN v_attempts >= 12 THEN 'gave_up' ELSE 'reopened' END; |   RETURN 'reopened';
 * @mutate supabase/migrations/20261015042253_declutter_slice4_handover_payout.sql |   UPDATE public.declutter_refunds SET payment_livemode = p_livemode WHERE id = p_refund_id AND payment_livemode IS NULL; |   UPDATE public.declutter_refunds SET payment_livemode = p_livemode WHERE id = p_refund_id;
 * @mutate supabase/migrations/20261030164712_declutter_porch_places.sql | as before (authz review 2.7).\n  SELECT min(round(2 * 6371000 | as before (authz review 2.7).\n  SELECT max(round(2 * 6371000
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { blankSqlComments } from "./helpers/blankNonCode";
import { effectiveDefs } from "./helpers/effectiveFunctionDefs";

const MIG_DIR = join(process.cwd(), "supabase/migrations");
const FILE = "20261015042253_declutter_slice4_handover_payout.sql";
const MIG = blankSqlComments(readFileSync(join(MIG_DIR, FILE), "utf8"));
const NO_QR_FILE = "20261018183715_declutter_handover_no_qr_no_code.sql";
const NO_QR = blankSqlComments(readFileSync(join(MIG_DIR, NO_QR_FILE), "utf8"));
const NO_DROPOFF_CODE_FILE = "20261018184535_declutter_delivery_no_dropoff_code.sql";
const DEFS = effectiveDefs(MIG_DIR);
const body = (name: string) => blankSqlComments(DEFS.get(name)?.stmt ?? "");
const flat = (s: string) => s.replace(/\s+/g, " ");

/** Member RPCs that change something: banned callers refused, no switch needed (row 62), order locked. */
const MEMBER_WRITES = [
  "declutter_book_pickup", "declutter_set_porch_time", "declutter_confirm_handover", "declutter_porch_photo", "declutter_seller_picked_up",
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
    // Seller delivery (20261027153244): the cap is items + the seller's rate (0 on every other handover).
    expect(done).toContain("v_debt := public.declutter_consume_fee_debt(o.seller_id, 'declutter_order_' || o.id::text, o.items_cents + v_rate);");
    expect(done).toContain("ON CONFLICT (order_id) DO NOTHING");
  });

  it("rows 67, 96: an open problem holds the handover, the auto-pay and the payout; after payment the sale is final", () => {
    expect(flat(body("declutter_complete_handover"))).toContain("IF p_by <> 'admin' AND EXISTS (SELECT 1 FROM public.declutter_problems p WHERE p.order_id = o.id AND p.status = 'open') THEN");
    expect(flat(body("declutter_payouts_due"))).toContain("AND NOT EXISTS (SELECT 1 FROM public.declutter_problems x WHERE x.order_id = p.order_id AND x.status = 'open')");
    // 141d (20261026155251): after the handover only the buyer reports, and only while the 24-hour window is open.
    expect(flat(body("declutter_report_problem"))).toContain("IF v_side <> 'buyer' OR NOT public.declutter_problem_window_open(o.id) THEN RAISE EXCEPTION 'sale_final'");
    expect(flat(MIG)).toContain("CREATE UNIQUE INDEX IF NOT EXISTS declutter_problems_one_open ON public.declutter_problems (order_id) WHERE status = 'open';");
  });

  it("row 95 (owner, 2026-10-15): a buyer no-show refunds EXACTLY the item price; the reason fixes the policy", () => {
    expect(flat(MIG)).toContain("WHEN reason IN ('buyer_no_show', 'admin_buyer_fault') THEN 'keep_buyer_fee'");
    expect(flat(MIG)).toContain("WHEN fee_policy = 'keep_buyer_fee' THEN paid_cents - kept_cents");
    expect(flat(body("declutter_record_refund"))).toContain("v_kept := v_order.premium_cents;");
    expect(flat(body("declutter_record_refund"))).toContain("WHEN p_reason IN ('seller_backed_out', 'seller_out', 'seller_no_show', 'not_as_described', 'helpr_fault') THEN 'full_seller_pays_fee'"); // + BUY-36's helpr_fault (20261031231150)
  });

  it("row 25 (owner 2026-10-18: porch pickup, no code): no code reaches either side; the handover table stays service-only", () => {
    expect(flat(body("declutter_my_handover"))).not.toMatch(/'code'|'code_locked'|h\.code/);
    expect(flat(MIG)).toContain("REVOKE ALL ON TABLE public.declutter_handovers FROM PUBLIC, anon, authenticated; GRANT ALL ON TABLE public.declutter_handovers TO service_role;");
    const c = flat(body("declutter_confirm_handover"));
    expect(c).not.toMatch(/wrong_code|code_locked|p_code IS|h\.code/);
    expect(c).toContain("IF v_side <> 'buyer' THEN RAISE EXCEPTION 'wrong_side' USING ERRCODE = '42501';");
  });

  it("row 99 (owner, 2026-10-15): the buyer's porch \"Picked up\" photo pays the seller right away unless a problem is open", () => {
    const p = flat(body("declutter_porch_photo"));
    expect(p).toContain("v_done := public.declutter_complete_handover(o.id, 'porch');");
    expect(p).toContain("IF EXISTS (SELECT 1 FROM public.declutter_problems p WHERE p.order_id = o.id AND p.status = 'open') THEN");
    expect(flat(NO_QR)).toContain("confirmed_by IN ('code', 'buyer', 'seller', 'porch', 'auto', 'admin')");
  });

  it("no QR and no 4-digit code (owner 2026-10-17 + 2026-10-18 pop-up): \"Left on porch\" with a photo, \"I got it\", the porch photo and the auto-pay only", () => {
    // Q2266 restated it with the porch note (20261021023158); still no code, read from the newest body below.
    // The handover money ruling (20261031004529) added the seller's word and the no-show clock to the read.
    expect(DEFS.get("declutter_my_handover")?.file).toBe("20261031004529_declutter_handover_both_confirm.sql");
    // #7 (20261028202844) restated it verbatim but the seller-delivery day check; still no code (checked below).
    // Shipping S2 (20261030000030) restated it verbatim but the shipped-order delivered-scan check; still no code.
    // Audit 1030 DB-3 (20261030061753) restated it verbatim but the meetup hour check; still no code.
    // The handover money ruling (20261031004529) restated it verbatim but the 60-day problem stepping aside; still no code.
    expect(DEFS.get("declutter_confirm_handover")?.file).toBe("20261031004529_declutter_handover_both_confirm.sql");
    const h = flat(body("declutter_my_handover"));
    expect(h).not.toMatch(/'qr'|lhdeclutter:|'code'/);
    const c = flat(body("declutter_confirm_handover"));
    expect(c).toContain("IF p_method IS NULL OR p_method <> 'buyer' THEN RAISE EXCEPTION 'invalid_method'");
    expect(c).not.toMatch(/'scan'|'code'/);
    // "Left on porch" needs the photo: declutter_porch_photo refuses a missing object.
    expect(flat(body("declutter_porch_photo"))).toContain("RAISE EXCEPTION 'photo_not_uploaded' USING ERRCODE = '22023';");
    // The newest confirmed_by check has no 'scan' ('code' stays: Helpr delivery's drop-off code records here).
    const f = flat(NO_QR);
    expect(f).toContain("ADD CONSTRAINT declutter_handovers_confirmed_by_check CHECK (confirmed_by IS NULL OR confirmed_by IN ('code', 'buyer', 'seller', 'porch', 'auto', 'admin'));");
    expect(f).not.toMatch(/IN \('scan'/);
  });

  it("owner 2026-10-18: porch auto-pay needs the set-out photo; door pickups end by the seller's \"Picked up\"; no NEW 'code' anywhere; Helpr delivery has no code", () => {
    const sw = flat(body("declutter_handover_sweep"));
    // Restated by seller delivery (20261027153244), #37 (20261028223036: the seller's link), then the porch DAY
    // (20261028225038: the auto-pay waits for the end of a porch day), the porch-photo rule unchanged throughout.
    // Then shipping S2 (20261030000030: 'ship' joins the four NOT IN lists), the porch rule unchanged.
    // Then the handover money ruling (20261031004529): the porch rule unchanged, door and meetup need the seller's word.
    // Then 20261031181404: only the (d) delivery reminder locks its order (the notice names the item); porch rule unchanged.
    expect(DEFS.get("declutter_handover_sweep")?.file).toBe("20261031181404_declutter_notices_name_the_item_sweep_remind_task.sql");
    // porch: both the query and the re-check under the lock
    expect(sw.split("(o2.handover <> 'porch' OR EXISTS (SELECT 1 FROM public.declutter_handovers h WHERE h.order_id = o2.id AND h.set_out_photo_path IS NOT NULL AND h.set_out_at + interval '24 hours' <= now()))").length - 1).toBe(1);
    expect(sw.split("(o.handover <> 'porch' OR EXISTS (SELECT 1 FROM public.declutter_handovers h WHERE h.order_id = o.id AND h.set_out_photo_path IS NOT NULL AND h.set_out_at + interval '24 hours' <= now()))").length - 1).toBe(1);
    const sp = flat(body("declutter_seller_picked_up"));
    expect(sp).toContain("IF v_side <> 'seller' THEN RAISE EXCEPTION 'wrong_side'");
    // Q2425 (20261027204500): a safe-spot meetup is handed over the same way as a door pickup.
    expect(sp).toContain("IF o.handover NOT IN ('pickup_home', 'meetup') THEN RAISE EXCEPTION 'not_a_door_pickup'");
    expect(sp).toContain("v_out := public.declutter_complete_handover(o.id, 'seller');");
    expect(sp).toContain("IF EXISTS (SELECT 1 FROM public.declutter_bookings b WHERE b.order_id = o.id AND b.slot_start > now()) THEN RAISE EXCEPTION 'before_pickup_time'");
    // 20261028200440 (seller notices open Selling), then A3-8 (20261028210552: only the notice lines naming the item); still no code (checked below).
    // Then audit 1c D3-5 (20261030031642: the notices name the item and open ?tab=buying; still no code).
    // Then LEAD-BUY44 (20261031140431: the seller is told Delivered too; still no code), then LEAD-NOHELPR-NOTICE (20261031170803: words only).
    expect(DEFS.get("declutter_delivery_on_task_event")?.file).toBe("20261031170803_declutter_no_helpr_notice_offers_refund.sql");
    expect(flat(body("declutter_delivery_on_task_event"))).not.toMatch(/4-digit|drop-off code/);
    expect(flat(NO_QR)).toContain("CREATE TRIGGER trg_declutter_handovers_no_new_code BEFORE INSERT OR UPDATE OF confirmed_by ON public.declutter_handovers");
    expect(flat(body("declutter_no_new_code_confirmation"))).toContain("IF NEW.confirmed_by = 'code' AND (TG_OP = 'INSERT' OR OLD.confirmed_by IS DISTINCT FROM 'code') THEN");
    // BUY-36 (20261031231150) restated helpr_task_delivered, helpr_task_confirm and helpr_task_view (a Helpr who can't finish);
    // still no code: the body checks below read that newest definition.
    expect(DEFS.get("helpr_task_delivered")?.file).toBe("20261031231150_helpr_delivery_cant_finish.sql");
    // helpr_task_view was restated verbatim from that file by 20261021131322 (only its Helpr-name line changed),
    // then it and helpr_task_confirm by 20261021181118 (only the take-home / payout amount rounded down to the
    // whole dollar, owner 2026-10-21), and helpr_task_view again by 20261027201327 (only the drop-off shown to the
    // assigned Helpr from accept, owner 2026-10-27), then by 20261030012018 (app audit 1c: adds handed_over_at and
    // problem_open for the three parties); the body checks below still read the newest definition.
    // Then audit 1c D3-5 (20261030031642: only the "Delivery done" words and link; the payout is as above).
    expect(DEFS.get("helpr_task_confirm")?.file).toBe("20261031231150_helpr_delivery_cant_finish.sql");
    expect(DEFS.get("helpr_task_view")?.file).toBe("20261031231150_helpr_delivery_cant_finish.sql");
    expect(flat(body("helpr_task_confirm"))).toContain("IF p_by IS NULL OR p_by NOT IN ('customer', 'auto', 'admin') THEN");
    expect(flat(body("helpr_task_view"))).not.toMatch(/dropoff_code|code_locked/);
    expect(flat(body("helpr_task_delivered"))).not.toMatch(/dropoff_code|wrong_code|'confirmed', 'code'/);
    const g = flat(blankSqlComments(readFileSync(join(MIG_DIR, NO_DROPOFF_CODE_FILE), "utf8")));
    expect(g).toContain("CREATE TRIGGER trg_helpr_tasks_no_new_code BEFORE INSERT OR UPDATE OF confirmed_by ON public.helpr_tasks");
  });

  it("row 45 (lead 2026-10-15): ONE public star rating across job and Declutter reviews, public ones only", () => {
    const st = flat(body("get_public_profile_stats"));
    // 20261021074131 (ID badge = Stripe Identity only) restates it from this body with only the verdict changed.
    // 20261030015205 (b62: test data never counts) restates it with the test-data exclusion only.
    expect(DEFS.get("get_public_profile_stats")?.file).toBe("20261030015205_test_data_never_counts.sql");
    expect(st).toContain("JOIN public.declutter_reviews dr ON dr.reviewee_id = t.user_id");
    expect(st).toContain("WHERE o.status = 'handed_over' AND (o.handed_over_at <= now() - interval '14 days' OR (SELECT count(*) FROM public.declutter_reviews d2 WHERE d2.order_id = dr.order_id) = 2)");
    expect(st).toContain("SELECT t.user_id, dr.stars::integer, false");
  });

  // A porch DAY (owner 2026-10-28, 20261028225038) waits for the END of the day instead: declutterPorchPickADay.test.ts.
  it("row 94: \"They didn't show\" opens 15 minutes after the booked time; the auto-pay waits 24 h", () => {
    expect(flat(body("declutter_report_no_show"))).toContain("ELSE b.slot_start + interval '15 minutes' END;");
    expect(flat(body("declutter_handover_sweep"))).toContain("public.declutter_pickup_anchor(b.slot_start, b.pickup_day) + interval '24 hours' <= now()");
    expect(MIG).toContain("cron.schedule('declutter-handovers'");
    expect(MIG).toContain("('declutter-handovers', interval");
  });

  it("review notes 2026-10-15: CSPRNG code, nearest item's pickup point, refund mode set once, only the recorded refund reopens", () => {
    expect(flat(body("declutter_new_handover_code"))).toContain("gen_random_uuid()");
    expect(body("declutter_new_handover_code")).not.toMatch(/(^|[^_])random\(\)/);
    // The nearest of the ORDER's pickup points (D-NEW14, 20261030164712): the frozen porch place, else every item's point.
    expect(flat(body("declutter_porch_photo"))).toContain("FROM public.declutter_order_pickup_points(o.id) pt;");
    expect(flat(body("declutter_order_pickup_points"))).toContain("WHERE c.order_id = p_order_id AND p.pickup_lat IS NOT NULL AND p.pickup_lng IS NOT NULL");
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
      expect(MIG + NO_QR, fn).toMatch(new RegExp(`REVOKE ALL ON FUNCTION public\\.${fn}\\([^)]*\\) FROM PUBLIC, anon;`));
    }
    for (const fn of ["declutter_leave_review", "declutter_admin_decide_problem"]) expect(body(fn), fn).toMatch(/public\.is_caller_banned\(\)/);
    expect(flat(body("declutter_admin_decide_problem"))).toContain("IF v_uid IS NULL OR NOT public.has_role(v_uid, 'admin') THEN");
    for (const fn of SERVICE_ONLY) {
      expect(MIG, fn).toMatch(new RegExp(`REVOKE ALL ON FUNCTION public\\.${fn}\\([^)]*\\) FROM PUBLIC, anon, authenticated;`));
      expect(MIG, fn).not.toMatch(new RegExp(`GRANT EXECUTE ON FUNCTION public\\.${fn}\\([^)]*\\) TO [^;]*authenticated`));
    }
  });
});
