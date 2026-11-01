/**
 * Board 141, Declutter side (docs/OPEN.md Q2272, Q2151 (a); migration 20261026155251_declutter_refund_requests):
 * a refund within 24 hours of getting the item, and a seller payout that waits until the sale is final.
 * Read from the definitions the migrations actually leave (effectiveDefs), so a later restatement that drops a
 * rule fails here. The behaviour is proven on the real chain in src/test/pglite/declutterRefundRequests.pglite.mjs
 * (93 checks, RED without the migration, the migration applied 3x).
 *
 * CLASS: no Declutter seller payout leaves before the buyer's 24 hours are over, and no refund after the
 * handover moves money without rebooking that payout first.
 *  1. The ONE payout queue (declutter_payouts_due) asks declutter_sale_final, and declutter-money reads seller
 *     payouts only through that queue (never the table).
 *  2. declutter_sale_final: 24 hours after the handover (and after a seller's "no"), plus the 10-minute margin;
 *     a request waiting on either side holds it.
 *  3. EVERY function that writes a refund for a handed-over order goes through declutter_refund_after_handover,
 *     which refuses a payout already touched and rebooks the payout in the same transaction. Inventory: every
 *     effective definition that calls declutter_record_refund or inserts into declutter_refunds either refuses
 *     anything but a PAID order or is that one function.
 *  4. A part refund is EXACTLY the offered amount and below the item price (owner 2026-10-21).
 *  5. Switch: every member RPC of the feature starts with require_feature('declutter_refund_requests').
 *  6. The buyer's problem report on a handed-over sale is allowed only while the window is open, and only the buyer's.
 *  7. The sweep sends an unanswered request or offer to an admin, and a full refund whose item was not confirmed
 *     back within 72 hours.
 *  9. A full refund the seller agreed is HELD until the seller confirms the item is back (owner 2026-10-23,
 *     issue #3558 answer 2): declutter_answer_refund('full') writes no refund; only declutter_refund_item_returned
 *     calls declutter_refund_after_handover('refund_request_full').
 *  8. The app shows the panel only behind the switch, and every amount it shows is the server's.
 *
 * @mutate supabase/migrations/20261026155251_declutter_refund_requests.sql |      AND public.declutter_sale_final(p.order_id)\n | \n
 * @mutate supabase/migrations/20261026155251_declutter_refund_requests.sql |                         AND rf.reason = 'refund_request_part' AND rf.status IN ('pending', 'failed')) |                         AND rf.reason = 'refund_request_part' AND rf.status IN ('failed'))
 * @mutate supabase/migrations/20261026155251_declutter_refund_requests.sql |                            + interval '10 minutes' |                            + interval '0 minutes'
 * @mutate supabase/migrations/20261026155251_declutter_refund_requests.sql | WHERE r.order_id = o.id AND r.status IN ('open', 'offered', 'returning')) THEN false | WHERE r.order_id = o.id AND r.status IN ('open', 'returning')) THEN false
 * @mutate supabase/migrations/20261026155251_declutter_refund_requests.sql | WHERE r.order_id = o.id AND r.status IN ('open', 'offered', 'returning')) THEN false | WHERE r.order_id = o.id AND r.status IN ('open', 'offered')) THEN false
 * @mutate supabase/migrations/20261031010243_declutter_never_got_it_no_return.sql |        SET status = 'returning', return_agreed_at = now(), return_by = now() + interval '72 hours'\n     WHERE id = r.id; |        SET status = 'returning', return_agreed_at = now(), return_by = now() + interval '1 hours'\n     WHERE id = r.id;
 * @mutate supabase/migrations/20261030071818_declutter_returns.sql |   IF r.status <> 'returning' THEN | IF false THEN
 * @mutate supabase/migrations/20261030071818_declutter_returns.sql |         OR (x.status = 'returning' AND x.return_by <= now() AND public.declutter_return_backstop_at(x) <= now()) | 
 * @mutate supabase/migrations/20261031010243_declutter_never_got_it_no_return.sql |   PERFORM public.declutter_rebook_payout(o.id, v_refunded);\n | \n
 * @mutate supabase/migrations/20261031010243_declutter_never_got_it_no_return.sql |     RAISE EXCEPTION 'already_refunded' USING ERRCODE = '55000';\n  END IF;\n  PERFORM 1 FROM public.declutter_payouts p WHERE p.order_id = o.id FOR UPDATE;\n  IF NOT public.declutter_payout_unsent(o.id) THEN\n    RAISE EXCEPTION 'payout_already_sent' USING ERRCODE = '55000',\n      HINT |     RAISE EXCEPTION 'already_refunded' USING ERRCODE = '55000';\n  END IF;\n  PERFORM 1 FROM public.declutter_payouts p WHERE p.order_id = o.id FOR UPDATE;\n  IF false THEN\n    RAISE EXCEPTION 'payout_already_sent' USING ERRCODE = '55000',\n      HINT
 * @mutate supabase/migrations/20261031010243_declutter_never_got_it_no_return.sql |     IF p_part_cents IS NULL OR p_part_cents <= 0 OR p_part_cents >= o.items_cents THEN |     IF p_part_cents IS NULL OR p_part_cents <= 0 OR p_part_cents > o.items_cents THEN
 * @mutate supabase/migrations/20261031010243_declutter_never_got_it_no_return.sql |     VALUES (o.id, o.stripe_payment_intent_id, 'refund_request_part', 'agreed_part', v_paid, 0, 0, p_part_cents) |     VALUES (o.id, o.stripe_payment_intent_id, 'refund_request_part', 'agreed_part', v_paid, 0, 0, p_part_cents + 1)
 * @mutate supabase/migrations/20261031181404_declutter_notices_name_the_item_sweep_remind_task.sql |   PERFORM public.require_feature('declutter_refund_requests');\n  IF v_uid IS NULL THEN\n    RAISE EXCEPTION 'not_authenticated' USING ERRCODE = '42501';\n  END IF;\n  SELECT x.order_id | IF v_uid IS NULL THEN\n    RAISE EXCEPTION 'not_authenticated' USING ERRCODE = '42501';\n  END IF;\n  SELECT x.order_id
 * @mutate supabase/migrations/20261031100935_declutter_problem_notices_name_the_item.sql |     IF v_side <> 'buyer' OR NOT public.declutter_problem_window_open(o.id) THEN |     IF v_side <> 'buyer' THEN
 * @mutate supabase/migrations/20261030071818_declutter_returns.sql |      WHERE (x.status = 'open' AND x.answer_by <= now()) OR (x.status = 'offered' AND x.offer_answer_by <= now()) |      WHERE (x.status = 'offered' AND x.offer_answer_by <= now())
 * @mutate supabase/migrations/20261101191500_declutter_checkout_pickup_time.sql |   IF o.status IN ('paid', 'refunded', 'handed_over') THEN |   IF o.status IN ('paid', 'refunded') THEN
 * @mutate supabase/functions/declutter-money/index.ts |     admin.rpc("declutter_payouts_due", { p_limit: BATCH }), |     admin.from("declutter_payouts").select("*"),
 * @mutate src/components/declutter/DeclutterHandoverViews.tsx |           {refundRequests && items > 0 && ( |           {true && items > 0 && (
 * @mutate src/components/declutter/DeclutterRefundRequest.tsx | then gets ${refundDollars(v.full_refund_cents)} back | then gets ${refundDollars(v.items_cents + 130)} back
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { blankComments, blankSqlComments } from "./helpers/blankNonCode";
import { effectiveDefs } from "./helpers/effectiveFunctionDefs";

const ROOT = process.cwd();
const MIG_DIR = join(ROOT, "supabase/migrations");
const DEFS = effectiveDefs(MIG_DIR);
const body = (name: string) => blankSqlComments(DEFS.get(name)?.stmt ?? "");
const flat = (s: string) => s.replace(/\s+/g, " ");
const MONEY = blankComments(readFileSync(join(ROOT, "supabase/functions/declutter-money/index.ts"), "utf8"));
const VIEWS = blankComments(readFileSync(join(ROOT, "src/components/declutter/DeclutterHandoverViews.tsx"), "utf8"));
const PANEL = blankComments(readFileSync(join(ROOT, "src/components/declutter/DeclutterRefundRequest.tsx"), "utf8"));

/** The feature's member RPCs: the declutter_*refund* functions granted to authenticated in their newest migration. */
function memberRefundRpcs(): string[] {
  const out: string[] = [];
  for (const [name, def] of DEFS) {
    if (!/^declutter_\w*refund/.test(name)) continue;
    const sql = blankSqlComments(readFileSync(join(MIG_DIR, def.file), "utf8"));
    if (new RegExp(String.raw`GRANT\s+EXECUTE\s+ON\s+FUNCTION\s+public\.${name}\s*\([^)]*\)\s+TO\s+[^;]*\bauthenticated\b`, "i").test(sql)) out.push(name);
  }
  return out.sort();
}

describe("Declutter refunds after the handover (board 141, 20261026155251)", () => {
  it("1. the payout queue asks whether the sale is final; declutter-money pays sellers only from that queue", () => {
    expect(flat(body("declutter_payouts_due"))).toMatch(/AND public\.declutter_sale_final\(p\.order_id\)/);
    // lh-money-escrow review should-fix 1: after an agreed part refund the seller is paid once that refund went through.
    expect(flat(body("declutter_payouts_due"))).toMatch(/rf\.reason = 'refund_request_part' AND rf\.status IN \('pending', 'failed'\)\)/);
    expect(MONEY).toMatch(/admin\.rpc\("declutter_payouts_due"/);
    expect(MONEY, "a seller payout read straight from the table would skip the hold").not.toMatch(/\.from\("declutter_payouts"\)/);
  });

  it("2. final = 24 hours after the handover (and after a 'no') plus the 10-minute margin; a waiting request holds it", () => {
    const f = flat(body("declutter_sale_final"));
    expect(f).toMatch(/o\.handed_over_at \+ interval '24 hours'/);
    expect(f).toMatch(/r\.declined_at \+ interval '24 hours'/);
    expect(f).toMatch(/\+ interval '10 minutes'/);
    expect(f).toMatch(/r\.status IN \('open', 'offered', 'returning'\)\) THEN false/);
  });

  it("3. every refund written for an order outside checkout refuses a handed-over sale, or is the one path that rebooks the payout", () => {
    const writers = [...DEFS.keys()].filter((n) => {
      const b = body(n);
      return n !== "declutter_record_refund" && (/declutter_record_refund\s*\(/.test(b) || /INSERT\s+INTO\s+public\.declutter_refunds\b/i.test(b));
    }).sort();
    // Inventory floor: the webhook's paid path, the close of a paid order, the refund after the handover, ...
    expect(writers.length).toBeGreaterThan(3);
    const after = flat(body("declutter_refund_after_handover"));
    expect(after).toMatch(/IF o\.status <> 'handed_over'/);
    const unsent = after.indexOf("IF NOT public.declutter_payout_unsent(o.id) THEN RAISE EXCEPTION 'payout_already_sent'");
    const firstWrite = Math.min(...[after.indexOf("INSERT INTO public.declutter_refunds"), after.indexOf("public.declutter_record_refund(")].filter((i) => i >= 0));
    expect(unsent, "the untouched-payout check").toBeGreaterThan(-1);
    expect(unsent, "checked before any refund row is written").toBeLessThan(firstWrite);
    expect(after).toMatch(/PERFORM public\.declutter_rebook_payout\(o\.id, v_refunded\);/);
    // EXACT both ways: every other refund writer, and the text that proves it never refunds the payment of a
    // handed-over sale (it refuses anything but a paid order, or it answers that same payment 'already_paid').
    const PROOF: Record<string, string> = {
      declutter_admin_decide_delivery_damage: "IF o.status <> 'paid' OR o.handover <> 'delivery'",
      declutter_close_paid_order: "IF o.status IS DISTINCT FROM 'paid' OR o.stripe_payment_intent_id IS NULL THEN RAISE EXCEPTION 'order_not_paid'",
      declutter_refund_paid_order: "IF o.status <> 'paid' OR o.stripe_payment_intent_id IS NULL THEN",
      // 141d fixed a replay: a second delivery of the paid event for a handed-over sale refunded it in full.
      declutter_mark_order_paid: "IF o.status IN ('paid', 'refunded', 'handed_over') THEN IF o.stripe_payment_intent_id IS NOT DISTINCT FROM p_payment_intent_id THEN RETURN jsonb_build_object('result', 'already_paid');",
      declutter_refund_party_gone: "o.stripe_payment_intent_id IS NOT DISTINCT FROM p_payment_intent_id AND o.status IN ('paid', 'handed_over', 'refunded') THEN RETURN jsonb_build_object('result', 'already_paid');",
    };
    expect(writers.filter((n) => n !== "declutter_refund_after_handover")).toEqual(Object.keys(PROOF).sort());
    const unproven = Object.entries(PROOF).filter(([n, proof]) => !flat(body(n)).includes(proof)).map(([n]) => n);
    expect(unproven, "a refund writer that could refund a handed-over sale without rebooking its payout").toEqual([]);
  });

  it("4. a part refund is EXACTLY the offered amount, and below the item price", () => {
    const after = flat(body("declutter_refund_after_handover"));
    expect(after).toMatch(/p_part_cents >= o\.items_cents THEN RAISE EXCEPTION 'invalid_amount'/);
    expect(after).toMatch(/VALUES \(o\.id, o\.stripe_payment_intent_id, 'refund_request_part', 'agreed_part', v_paid, 0, 0, p_part_cents\)/);
    expect(flat(body("declutter_answer_refund"))).toMatch(/p_offer_cents >= o\.items_cents THEN RAISE EXCEPTION 'invalid_amount'/);
  });

  it("5. every member RPC of the feature requires the switch, server side", () => {
    const rpcs = memberRefundRpcs();
    expect(rpcs.length).toBeGreaterThanOrEqual(5);
    const missing = rpcs.filter((n) => !/PERFORM public\.require_feature\('declutter_refund_requests'\);/.test(body(n)));
    expect(missing).toEqual([]);
  });

  it("6. on a handed-over sale only the buyer reports a problem, and only while the window is open", () => {
    expect(flat(body("declutter_report_problem"))).toMatch(
      /IF o\.status = 'handed_over' THEN .*IF v_side <> 'buyer' OR NOT public\.declutter_problem_window_open\(o\.id\) THEN RAISE EXCEPTION 'sale_final'/);
  });

  it("7. the sweep sends an unanswered request, and an unanswered offer, to an admin", () => {
    const s = flat(body("declutter_refund_request_sweep"));
    expect(s).toMatch(/\(x\.status = 'open' AND x\.answer_by <= now\(\)\) OR \(x\.status = 'offered' AND x\.offer_answer_by <= now\(\)\)/);
    // Declutter returns (20261030071818): a return goes to an admin at the later of return_by and the return day/time + 24h.
    expect(s).toMatch(/OR \(x\.status = 'returning' AND x\.return_by <= now\(\) AND public\.declutter_return_backstop_at\(x\) <= now\(\)\)/);
    expect(s).toMatch(/declutter_refund_request_to_admin\(/);
  });

  it("9. a full refund waits for the item: only the seller's 'I got it back' sends it (#3558 answer 2)", () => {
    const callers = [...DEFS.keys()].filter((n) => /declutter_refund_after_handover\([^;]*'refund_request_full'/.test(flat(body(n)))).sort();
    // BUY-25 (owner 10-30) refunds at once when the buyer never got it, under its own reason (seller_no_show), so not here.
    expect(callers).toEqual(["declutter_refund_item_returned"]);
    expect(flat(body("declutter_answer_refund"))).toMatch(/IF r\.reason = 'not_received' THEN v_out := public\.declutter_refund_after_handover\(o\.id, 'seller_no_show', NULL\)/);
    const ans = flat(body("declutter_answer_refund"));
    expect(ans).toMatch(/SET status = 'returning', return_agreed_at = now\(\), return_by = now\(\) \+ interval '72 hours'/);
    expect(flat(body("declutter_refund_item_returned"))).toMatch(/IF r\.status <> 'returning' THEN RAISE EXCEPTION 'refund_already_answered'/);
  });

  it("8. the app shows the panel only behind the switch, with the server's amounts", () => {
    expect(VIEWS).toMatch(/useFeature\("declutter_refund_requests"\)/);
    // #6: never on a free claim (nothing was paid, nothing to refund).
    expect(VIEWS).toMatch(/\{refundRequests && items > 0 && \(/);
    expect(PANEL).toMatch(/then gets \$?\{refundDollars\(v\.full_refund_cents\)\} back/);
    expect(PANEL, "no refund arithmetic on screen").not.toMatch(/items_cents\s*[+*-]|full_refund_cents\s*[+*-]/);
  });
});
