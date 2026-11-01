/**
 * GUARD (Q2453): tips on Declutter deliveries. Reads the NEWEST definitions (effectiveDefs, any
 * dollar-quote tag) and the edge and app sources, and pins what a later change must keep:
 *   - only the delivery's own buyer tips, only once it is done ('confirmed'), only its Helpr (never
 *     themselves, never across a block), $3..$1,000, behind the delivery's switch;
 *   - the ledger is read by its two people only and written by no member; the page is attached
 *     once and marked paid once (the Helpr is told once, by name and amount, with no fee word);
 *   - the money is the job tip's: the class check in src/test/tipFeesOneDefinition.test.ts now
 *     includes declutter-checkout (one tipChargeBreakdown, application fee = its fee, one line of
 *     its charge), and the edge proof src/test/edge/declutter-delivery-tip.test.ts runs the code;
 *   - the buyer's delivery card offers the tip only once it is done, through the job tip's picker;
 *   - owner #3706 (option 2): a Helpr with no payout account still gets the tip, HELD (charged on the
 *     platform) and paid with their held delivery pay: the queue names each held unsent tip and
 *     declutter-money sends exactly it, from its own charge, as one more part of that payout.
 * Backend proof (55 checks measured 2026-10-28, 3x replay, 11 planted defects each RED): src/test/pglite/helprTaskTips.pglite.mjs.
 *
 * @mutate supabase/migrations/20261101051951_tips_wait_for_helpr_id.sql |   IF public.payout_waits_on_identity(t.helpr_id) THEN |   IF false THEN
 * @mutate supabase/migrations/20261101051951_tips_wait_for_helpr_id.sql |        AND NOT public.payout_waits_on_identity(t.helpr_id)\n |
 * @mutate supabase/migrations/20261101051951_tips_wait_for_helpr_id.sql |  IF NOT FOUND OR t.customer_id IS DISTINCT FROM v_uid THEN |  IF NOT FOUND THEN
 * @mutate supabase/migrations/20261101051951_tips_wait_for_helpr_id.sql |  IF t.status <> 'confirmed' THEN |  IF t.status = 'cancelled' THEN
 * @mutate supabase/migrations/20261028014848_helpr_task_tips.sql | USING (tipper_id = (SELECT auth.uid()) OR helpr_id = (SELECT auth.uid())); | USING (true);
 * @mutate supabase/migrations/20261028014848_helpr_task_tips.sql |  IF r.payment_status = 'paid' THEN\n    RETURN jsonb_build_object('result', 'already' |  IF false THEN\n    RETURN jsonb_build_object('result', 'already'
 * @mutate supabase/migrations/20261028014848_helpr_task_tips.sql | REVOKE ALL ON FUNCTION public.helpr_task_tip_paid(uuid, text, text, integer) FROM PUBLIC, anon, authenticated; | REVOKE ALL ON FUNCTION public.helpr_task_tip_paid(uuid, text, text, integer) FROM PUBLIC, anon;
 * @mutate src/components/declutter/DeclutterDeliveryViews.tsx | {side === "buyer" && v.status === "confirmed" && <DeliveryTipPanel | {side === "buyer" && <DeliveryTipPanel
 * @mutate src/components/declutter/DeclutterDeliveryViews.tsx | tipCents={tips.data?.get(t.task_id) ?? 0} | tipCents={0}
 * @mutate supabase/migrations/20261101051951_tips_wait_for_helpr_id.sql |  v_held := NOT EXISTS (SELECT 1 FROM public.profiles pr WHERE pr.user_id = t.helpr_id AND pr.stripe_account_id IS NOT NULL); |  v_held := false;
 * @mutate supabase/migrations/20261028014848_helpr_task_tips.sql | WHERE x.task_id = t.id AND x.held AND x.payment_status = 'paid' AND x.payout_transfer_id IS NULL), '[]'::jsonb) | WHERE x.task_id = t.id AND x.held AND x.payment_status = 'paid'), '[]'::jsonb)
 * @mutate supabase/migrations/20261028014848_helpr_task_tips.sql |      AND (p.id IS NULL OR p.status NOT IN ('pending', 'failed', 'held_for_review') |      AND (p.id IS NULL
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { blankComments, blankSqlComments } from "./helpers/blankNonCode";
import { effectiveDefs } from "./helpers/effectiveFunctionDefs";
import { readdirSync } from "./helpers/trackedFiles";

const REPO = resolve(__dirname, "..", "..");
const MIG = join(REPO, "supabase", "migrations");
const DEFS = effectiveDefs(MIG);
const flat = (name: string) => blankSqlComments(DEFS.get(name)?.stmt ?? "").replace(/\s+/g, " ");
const all = readdirSync(MIG).filter((f) => f.endsWith(".sql")).sort()
  .map((f) => blankSqlComments(readFileSync(join(MIG, f), "utf8"))).join("\n").replace(/\s+/g, " ");
const src = (p: string) => blankComments(readFileSync(join(REPO, p), "utf8"));

describe("tips on Declutter deliveries (Q2453)", () => {
  it("the inventory read the functions", () => {
    for (const fn of ["helpr_task_tip_start", "helpr_task_tip_attach", "helpr_task_tip_paid"]) expect(flat(fn).length, fn).toBeGreaterThan(300);
  });

  it("only the delivery's own buyer, once it is done, for its Helpr, $3..$1,000, behind the switch", () => {
    const s = flat("helpr_task_tip_start");
    expect(s).toContain("v_uid uuid := (SELECT auth.uid());");
    expect(s).toContain("IF public.is_caller_banned() THEN RAISE EXCEPTION 'account_restricted'");
    expect(s).toContain("IF p_tip_cents IS NULL OR p_tip_cents < 300 OR p_tip_cents > 100000 OR p_attempt_id IS NULL THEN RAISE EXCEPTION 'invalid_tip'");
    expect(s).toContain("IF NOT FOUND OR t.customer_id IS DISTINCT FROM v_uid THEN RAISE EXCEPTION 'task_not_found'");
    expect(s).toContain("PERFORM public.helpr_task_source_require_feature(t.source_kind);");
    expect(s).toContain("IF t.status <> 'confirmed' THEN RAISE EXCEPTION 'tip_not_yet'");
    expect(s).toContain("IF t.helpr_id IS NULL OR t.helpr_id = v_uid OR public.are_users_blocked(v_uid, t.helpr_id) THEN RAISE EXCEPTION 'tip_unavailable'");
    // The row is the caller's, for the task's own Helpr: never an id from the request.
    expect(s).toContain("VALUES (t.id, v_uid, t.helpr_id, p_tip_cents, p_attempt_id, v_held)");
  });

  it("BUY-43: no tip, and no tip row or Stripe page, until the Helpr has passed their ID check (owner 2026-10-30)", () => {
    const s = flat("helpr_task_tip_start");
    const gate = s.indexOf("IF public.payout_waits_on_identity(t.helpr_id) THEN RAISE EXCEPTION 'tip_waits_on_identity'");
    expect(gate).toBeGreaterThan(0);
    // Before the row is written (declutter-checkout opens the Stripe page only from that row).
    expect(gate).toBeLessThan(s.indexOf("INSERT INTO public.helpr_task_tips"));
    expect(flat("declutter_delivery_tip_open")).toContain("AND NOT public.payout_waits_on_identity(t.helpr_id)");
  });

  it("the ledger: its two people read it, no member writes it, the money functions are service only", () => {
    expect(all).toContain("REVOKE ALL ON TABLE public.helpr_task_tips FROM PUBLIC, anon, authenticated; GRANT SELECT ON TABLE public.helpr_task_tips TO authenticated;");
    expect(all).toContain("CREATE POLICY \"helpr task tips: tipper and helpr read own\" ON public.helpr_task_tips FOR SELECT TO authenticated USING (tipper_id = (SELECT auth.uid()) OR helpr_id = (SELECT auth.uid()));");
    expect(all).toContain("REVOKE ALL ON FUNCTION public.helpr_task_tip_paid(uuid, text, text, integer) FROM PUBLIC, anon, authenticated; GRANT EXECUTE ON FUNCTION public.helpr_task_tip_paid(uuid, text, text, integer) TO service_role;");
    expect(all).toContain("REVOKE ALL ON FUNCTION public.helpr_task_tip_attach(uuid, text) FROM PUBLIC, anon, authenticated; GRANT EXECUTE ON FUNCTION public.helpr_task_tip_attach(uuid, text) TO service_role;");
    expect(all).toContain("REVOKE ALL ON FUNCTION public.helpr_task_tip_start(uuid, integer, uuid) FROM PUBLIC, anon;");
    expect(all).toMatch(/CREATE TRIGGER trg_helpr_task_tips_seed BEFORE INSERT ON public\.helpr_task_tips FOR EACH ROW EXECUTE FUNCTION public\.helpr_task_rows_seed\(\);/);
  });

  it("a page is attached once, and paid once: the Helpr is told once, who and how much, with no fee word", () => {
    expect(flat("helpr_task_tip_attach")).toContain("WHERE id = p_tip_id AND payment_status = 'pending' AND stripe_session_id IS NULL;");
    const p = flat("helpr_task_tip_paid");
    expect(p).toContain("SELECT * INTO r FROM public.helpr_task_tips WHERE id = p_tip_id FOR UPDATE;");
    expect(p.indexOf("IF r.payment_status = 'paid' THEN RETURN jsonb_build_object('result', 'already'")).toBeGreaterThan(0);
    expect(p.indexOf("'already'")).toBeLessThan(p.indexOf("PERFORM public.declutter_notify("));
    expect(p).toContain("'You received a tip!'");
    expect(p).toMatch(/format\('%s tipped you \$%s for a delivery\. Thanks for the great work!'/);
    expect(p).not.toMatch(/fee/i);
  });

  it("the webhook routes the tip page and marks it paid only when Stripe says paid", () => {
    const hook = src("supabase/functions/stripe-webhook/handlers/declutterCheckout.ts");
    expect(hook).toContain('"declutter_delivery_tip"]);');
    expect(hook).toMatch(/if \(meta\.kind === "declutter_delivery_tip"\) return settleDeliveryTip\(session, meta, ctx\);/);
    expect(hook).toMatch(/async function settleDeliveryTip[\s\S]*?if \(session\.payment_status !== "paid"\) \{[\s\S]*?return;[\s\S]*?supabase\.rpc\("helpr_task_tip_paid"/);
    // Test accounts tip on the test key: the kind is a routed test checkout.
    expect(src("supabase/functions/_shared/stripeMode.ts")).toMatch(/ROUTED_TEST_CHECKOUT_KINDS = new Set\(\[[^\]]*"declutter_delivery_tip"/);
  });

  it("the buyer's delivery card offers the tip only once it is done, through the job tip's picker and total", () => {
    const view = src("src/components/declutter/DeclutterDeliveryViews.tsx");
    expect(view).toContain('{side === "buyer" && v.status === "confirmed" && <DeliveryTipPanel taskId={taskId} helprFirstName={v.helpr_first_name} />}');
    const panel = src("src/components/declutter/DeliveryTipPanel.tsx");
    expect(panel).toMatch(/import \{ TipCostBreakdown, TipPicker, centsLabel \} from "@\/components\/TipCostBreakdown";/);
    expect(panel).toContain("startDeliveryTip(taskId, cents, attempt.current)");
    expect(panel).toContain("attempt.current = crypto.randomUUID();");
    expect(panel).not.toMatch(/\bfees?\b/i);
  });

  it("the Helpr sees the buyer's tip on that delivery, and the notice opens Deliver for pay where it shows", () => {
    const view = src("src/components/declutter/DeclutterDeliveryViews.tsx");
    expect(view).toContain("tipCents={tips.data?.get(t.task_id) ?? 0}");
    expect(view).toContain("{tipCents > 0 && <p className=\"text-sm\">The buyer tipped you {formatPrice(tipCents)}.</p>}");
    expect(flat("helpr_task_tip_paid")).toContain("'/declutter?view=deliver', r.tipper_id);");
    expect(src("src/lib/declutter/deliveryTip.ts")).toContain('.eq("helpr_id", userId).eq("payment_status", "paid")');
  });

  it("owner #3706: a Helpr with no payout account is held and paid with the delivery pay, exactly the tip, once", () => {
    const st = flat("helpr_task_tip_start");
    expect(st).toContain("v_held := NOT EXISTS (SELECT 1 FROM public.profiles pr WHERE pr.user_id = t.helpr_id AND pr.stripe_account_id IS NOT NULL);");
    expect(st).toContain("IF v_held AND NOT EXISTS (SELECT 1 FROM public.helpr_task_payouts p WHERE p.task_id = t.id AND p.status IN ('pending', 'failed', 'held_for_review')) THEN RAISE EXCEPTION 'tip_unavailable'");
    const due = flat("helpr_task_payouts_due");
    expect(due).toContain("WHERE x.task_id = t.id AND x.held AND x.payment_status = 'paid' AND x.payout_transfer_id IS NULL), '[]'::jsonb)");
    expect(flat("helpr_task_tip_payout_sent")).toContain("IF NOT FOUND OR NOT r.held OR r.payment_status <> 'paid' THEN RETURN 'mismatch';");
    expect(all).toContain("REVOKE ALL ON FUNCTION public.helpr_task_tip_payout_sent(uuid, text) FROM PUBLIC, anon, authenticated;");
    const money = src("supabase/functions/declutter-money/index.ts");
    expect(money).toContain("parts = [...helprPayoutParts(h.amount_cents, h.payment_intent_id, h.raised_cents, h.raise_parts), ...heldTipParts(h.tip_parts)];");
    expect(money).toContain('admin.rpc("helpr_task_tip_payout_sent"');
    const parts = src("supabase/functions/_shared/helprPayoutParts.ts");
    expect(parts).toContain("return { raiseId: null, tipId: t.tip_id, paymentIntentId: t.payment_intent_id, amountCents: t.cents };");
    const checkout = src("supabase/functions/declutter-checkout/index.ts");
    expect(checkout).toContain("...(held ? {} : { transfer_data: { destination: account as string }, application_fee_amount: q.feeCents }),");
    expect(checkout).toContain("if (!held && !account) {");
    // lh-money-escrow review: a held tip nothing will send is listed for staff and paged every run.
    expect(flat("helpr_task_tips_stranded")).toContain("WHERE x.held AND x.payment_status = 'paid' AND x.payout_transfer_id IS NULL AND (p.id IS NULL OR p.status NOT IN ('pending', 'failed', 'held_for_review')");
    expect(all).toContain("REVOKE ALL ON FUNCTION public.helpr_task_tips_stranded() FROM PUBLIC, anon, authenticated;");
    expect(money).toContain('await admin.rpc("helpr_task_tips_stranded", {});');
  });
});
