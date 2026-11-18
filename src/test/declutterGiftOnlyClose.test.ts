/**
 * Q?giftclose: a Declutter order the buyer's gift card paid IN FULL (no payment intent, gift_cents > 0) can be cancelled
 * and refunded, and the gift goes back exactly once (20261118002340_declutter_gift_only_close_and_refund).
 *
 * Class: in every effective declutter_* SQL function (newest definition), a refusal gated on the ORDER having no
 * payment intent (`o.stripe_payment_intent_id IS NULL`) must also require that it has no gift
 * (`AND COALESCE(o.gift_cents, 0) <= 0`), or a gift-only order is refused as unpaid and its gift never comes back.
 * Exactly once: one gift-only refund row per order (unique index + declutter_record_refund's lookup by order), the gift
 * restore is keyed by the refund row and answers already_restored on a retry, and declutter-money passes that key.
 * Mixed card + gift: an agreed part refund splits with declutter_refund_gift_split, like every other refund row.
 * Behaviour (real Postgres, double cancel included): src/test/pglite/declutterGiftOnlyClose.pglite.mjs (25 PASS;
 * 20 FAIL with NEW_MIGRATION=skip).
 *
 * @mutate supabase/migrations/20261118002340_declutter_gift_only_close_and_refund.sql | (o.stripe_payment_intent_id IS NULL AND COALESCE(o.gift_cents, 0) <= 0) THEN\n    RAISE EXCEPTION 'order_not_paid' | o.stripe_payment_intent_id IS NULL THEN\n    RAISE EXCEPTION 'order_not_paid'
 * @mutate supabase/migrations/20261118002340_declutter_gift_only_close_and_refund.sql | (o.stripe_payment_intent_id IS NULL AND COALESCE(o.gift_cents, 0) <= 0) THEN\n    RETURN 'order_not_paid' | o.stripe_payment_intent_id IS NULL THEN\n    RETURN 'order_not_paid'
 * @mutate supabase/migrations/20261118002340_declutter_gift_only_close_and_refund.sql | (o.stripe_payment_intent_id IS NULL AND COALESCE(o.gift_cents, 0) <= 0) THEN\n    RAISE EXCEPTION 'order_not_handed_over' | o.stripe_payment_intent_id IS NULL THEN\n    RAISE EXCEPTION 'order_not_handed_over'
 * @mutate supabase/migrations/20261118002340_declutter_gift_only_close_and_refund.sql |                  OR (o.stripe_payment_intent_id IS NULL AND r.stripe_payment_intent_id IS NULL AND r.order_id = o.id)) THEN | ) THEN
 * @mutate supabase/migrations/20261118002340_declutter_gift_only_close_and_refund.sql |             COALESCE(public.declutter_refund_gift_split(o.id, p_part_cents), 0)) | 0)
 * @mutate supabase/migrations/20261118002340_declutter_gift_only_close_and_refund.sql | 'Refund on its way', public.declutter_refund_notice_names_gift(v_refund,\n    CASE WHEN p_reason = 'refund_request_part' | 'Refund on its way', (\n    CASE WHEN p_reason = 'refund_request_part'
 * @mutate supabase/migrations/20261105042758_declutter_gift_refund_rows.sql | CREATE UNIQUE INDEX IF NOT EXISTS declutter_refunds_gift_only_one_per_order | CREATE INDEX IF NOT EXISTS declutter_refunds_gift_only_one_per_order
 * @mutate supabase/migrations/20261105030604_declutter_gift_cards.sql |   SELECT id, amount INTO v_existing FROM public.gift_cards WHERE restored_declutter_refund_key = p_refund_key; |   SELECT id, amount INTO v_existing FROM public.gift_cards WHERE false;
 * @mutate supabase/functions/declutter-money/index.ts | p_refund_key: `declutter_refund:${r.refund_id}` | p_refund_key: `declutter_refund:${crypto.randomUUID()}`
 */
import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { effectiveDefs } from "./helpers/effectiveFunctionDefs";
import { blankComments, blankSqlComments } from "./helpers/blankNonCode";

/** Order-has-no-payment-intent tests that are NOT a gift-blind refusal, each with why (exact both ways). */
// @two-way src/test/declutterGiftOnlyClose.test.ts:ALLOWED is exact both ways
const ALLOWED: Record<string, string> = {
  declutter_refund_gift_split: "a CASE branch that SIZES the gift share of a gift-only order (all of it), not a refusal",
  declutter_refund_paid_order: "no caller: no newest SQL definition, edge function or src/ file calls it (grep 2026-11-17); left as is, reported",
};

const defs = effectiveDefs("supabase/migrations");
const flat = (name: string) => {
  const d = defs.get(name);
  expect(d, `${name} has an effective definition`).toBeTruthy();
  return blankSqlComments(d!.stmt).replace(/\s+/g, " ");
};

describe("Q?giftclose: a gift-only Declutter order can be cancelled and refunded, once", () => {
  it("no declutter_* function refuses an order for having no payment intent without also requiring no gift", () => {
    const offenders: string[] = [];
    const seen: string[] = [];
    let paired = 0;
    for (const [name, def] of defs) {
      if (!name.startsWith("declutter_")) continue;
      const body = blankSqlComments(def.stmt).replace(/\s+/g, " ");
      for (const m of body.matchAll(/\bo\.stripe_payment_intent_id IS NULL( AND COALESCE\(o\.gift_cents, 0\) <= 0| AND r\.stripe_payment_intent_id IS NULL AND r\.order_id = o\.id)?/g)) {
        if (m[1]) { paired++; continue; }
        if (name in ALLOWED) { if (!seen.includes(name)) seen.push(name); continue; }
        offenders.push(`${name} (${def.file}): ${body.slice(m.index, m.index + 90)}`);
      }
    }
    expect(seen.sort(), "ALLOWED is exact both ways").toEqual(Object.keys(ALLOWED).sort());
    // Inventory floor: close_paid_order, no_helpr_refusal, refund_after_handover (x2), delivery_refund, ship_refund_after_void.
    expect(paired).toBeGreaterThan(5);
    expect(offenders).toEqual([]);
  });

  it("the three entry points read the gift (newest definitions are this migration's)", () => {
    for (const name of ["declutter_close_paid_order", "declutter_no_helpr_refusal", "declutter_refund_after_handover"]) {
      expect(defs.get(name)?.file, name).toMatch(/20261118002340_declutter_gift_only_close_and_refund\.sql$/);
    }
    expect(flat("declutter_close_paid_order")).toContain(
      "IF o.status IS DISTINCT FROM 'paid' OR (o.stripe_payment_intent_id IS NULL AND COALESCE(o.gift_cents, 0) <= 0) THEN RAISE EXCEPTION 'order_not_paid'",
    );
  });

  it("a refund after the handover finds a gift-only refund row by order, splits a part refund and names the gift", () => {
    const body = flat("declutter_refund_after_handover");
    const dupe = body.indexOf(
      "WHERE r.stripe_payment_intent_id = o.stripe_payment_intent_id OR (o.stripe_payment_intent_id IS NULL AND r.stripe_payment_intent_id IS NULL AND r.order_id = o.id)) THEN RAISE EXCEPTION 'already_refunded'",
    );
    expect(dupe).toBeGreaterThan(-1);
    expect(body).toContain("kept_cents, refund_cents, gift_refund_cents) VALUES (o.id, o.stripe_payment_intent_id, 'refund_request_part', 'agreed_part', v_paid, 0, 0, p_part_cents, COALESCE(public.declutter_refund_gift_split(o.id, p_part_cents), 0))");
    expect(body).toContain("'Refund on its way', public.declutter_refund_notice_names_gift(v_refund, CASE WHEN p_reason = 'refund_request_part'");
  });

  it("the gift goes back exactly once: one gift-only row per order, a restore keyed by the row, the key passed by the cron", () => {
    // Newest definition of the index across migrations.
    const dir = "supabase/migrations";
    let idx = "";
    for (const f of readdirSync(dir).filter((x) => x.endsWith(".sql")).sort()) {
      const sql = blankSqlComments(readFileSync(`${dir}/${f}`, "utf8"));
      for (const m of sql.matchAll(/CREATE (UNIQUE )?INDEX IF NOT EXISTS declutter_refunds_gift_only_one_per_order[^;]*;/g)) idx = m[0];
    }
    expect(idx.replace(/\s+/g, " ")).toBe(
      "CREATE UNIQUE INDEX IF NOT EXISTS declutter_refunds_gift_only_one_per_order ON public.declutter_refunds (order_id) WHERE stripe_payment_intent_id IS NULL;",
    );
    const rec = flat("declutter_record_refund");
    expect(rec).toContain("IF p_payment_intent_id IS NULL THEN SELECT r.id INTO v_id FROM public.declutter_refunds r WHERE r.order_id = p_order_id AND r.stripe_payment_intent_id IS NULL;");
    const restore = flat("restore_gift_card_for_declutter_order");
    const lookup = restore.indexOf("SELECT id, amount INTO v_existing FROM public.gift_cards WHERE restored_declutter_refund_key = p_refund_key; IF FOUND THEN RETURN jsonb_build_object('outcome', 'already_restored'");
    const mint = restore.indexOf("INSERT INTO public.gift_cards");
    expect(lookup).toBeGreaterThan(-1);
    expect(mint).toBeGreaterThan(lookup);
    const money = blankComments(readFileSync("supabase/functions/declutter-money/index.ts", "utf8"));
    expect(money).toContain('admin.rpc("restore_gift_card_for_declutter_order", {\n          p_order_id: r.order_id, p_refund_key: `declutter_refund:${r.refund_id}`, p_cents: giftCents,');
  });
});
