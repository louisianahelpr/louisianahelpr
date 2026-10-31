/**
 * Owner 2026-10-21: "round the real payout". A Helpr's DELIVERY payout
 * (Declutter delivery, helpr_task_payouts) is whole dollars, rounded DOWN, and
 * the platform keeps the cents: the same rule as a Jobs payout
 * (roundPayoutDownCents, Q236, guarded by helprPayoutRoundedDown.test.ts).
 * Seller proceeds and the delivery price are NOT rounded.
 *
 * A delivery payout is written in SQL, so the rule has one SQL twin,
 * public.helpr_payout_round_down_cents (migration 20261021181118). TS == SQL
 * for every cent 0..100000 is proven by executing both in
 * src/test/pglite/declutterDelivery.pglite.mjs. This guard holds the class:
 *
 *  1. The SQL twin floors exactly like roundPayoutDownCents (NULL -> 0, zero
 *     and negatives unchanged, else down to the whole dollar).
 *  2. Inventory from source: every live public function whose NEWEST body
 *     computes a delivery take-home (`pay_cents - fee_cents`) is listed here,
 *     exact both ways, and every such expression in it is wrapped in the twin.
 *  3. The newest CHECK helpr_task_payouts_amount stores only the rounded amount.
 *  4. helpr_task_confirm writes the rounded amount and says it in whole dollars.
 *  5. The payout reaches Stripe as the row's own amount: helpr_task_payouts_due
 *     selects p.amount_cents and declutter-money's Helpr leg sends it unchanged.
 *  6. The client mirror (helprTakeHomeCents) floors through roundPayoutDownCents.
 */
// @mutate supabase/migrations/20261021181118_helpr_delivery_payout_round_down.sql |               ELSE (p_cents / 100) * 100 END; |               ELSE p_cents END;
// @mutate supabase/migrations/20261030031642_helpr_delivery_notices_name_the_item.sql |   v_amount := public.helpr_payout_round_down_cents(t.pay_cents - t.fee_cents); |   v_amount := t.pay_cents - t.fee_cents;
// @mutate supabase/migrations/20261031220617_helpr_setup_fee_from_payout_restated.sql |   CHECK (amount_cents = public.helpr_payout_round_down_cents(pay_cents - fee_cents) - setup_fee_cents AND amount_cents >= 0); |   CHECK (amount_cents = pay_cents - fee_cents - setup_fee_cents AND amount_cents >= 0);
// @mutate supabase/migrations/20261031075157_helpr_open_deliveries_hide_backed_out.sql |          public.helpr_payout_round_down_cents(t.pay_cents - t.fee_cents), t.open_until, t.latest_pickup_at |          t.pay_cents - t.fee_cents, t.open_until, t.latest_pickup_at
// @mutate supabase/migrations/20261030012018_helpr_delivery_seller_handover.sql | THEN public.helpr_payout_round_down_cents(t.pay_cents - t.fee_cents) END, | THEN t.pay_cents - t.fee_cents END,
// @mutate supabase/migrations/20261030031642_helpr_delivery_notices_name_the_item.sql | ELSE format('"%s" is delivered. $%s is on its way to your payout account.', t.title, (v_amount / 100)::text) END, | ELSE format('"%s" is delivered. $%s is on its way to your payout account.', t.title, to_char(v_amount / 100.0, 'FM999990.00')) END,
// @mutate supabase/functions/declutter-money/index.ts |       parts = [...helprPayoutParts(h.amount_cents, h.payment_intent_id, h.raised_cents, h.raise_parts), ...heldTipParts(h.tip_parts)]; |       parts = [...helprPayoutParts(h.amount_cents + 50, h.payment_intent_id, h.raised_cents, h.raise_parts), ...heldTipParts(h.tip_parts)];
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { blankComments } from "./helpers/blankNonCode";
import { newestCheckBody, newestFunction } from "./helpers/parityReaders";
import { latestFunctionDefs } from "./helpers/rpcErrorInventory";
import { roundPayoutDownCents } from "../../supabase/functions/_shared/money";
import { helprTakeHomeCents } from "@/lib/declutter/delivery";

const flat = (s: string) => s.replace(/\s+/g, " ").trim();
const TWIN = "helpr_payout_round_down_cents";
/** A delivery take-home expression, with or without the `t.` alias. */
const TAKE_HOME = /\b(?:t\.)?pay_cents\s*-\s*(?:t\.)?fee_cents\b/g;
const WRAPPED = new RegExp(`\\bpublic\\.${TWIN}\\(\\s*(?:t\\.)?pay_cents\\s*-\\s*(?:t\\.)?fee_cents\\s*\\)`, "g");

/** Every live function whose newest body computes a delivery take-home. EXACT.
 * helpr_route_suggestions: the "On your way" add-on stops (20261027200024, Train D) show each stop's take-home. */
const TAKE_HOME_READERS = ["helpr_my_tasks", "helpr_route_suggestions", "helpr_task_confirm", "helpr_task_view", "helpr_tasks_open_near"];

describe("Helpr delivery payouts are whole dollars, rounded down (owner 2026-10-21)", () => {
  it("the SQL twin floors exactly like roundPayoutDownCents", () => {
    const body = flat(newestFunction(TWIN).body);
    expect(body.length).toBeGreaterThan(50);
    expect(body).toContain("WHEN p_cents IS NULL THEN 0");
    expect(body).toContain("WHEN p_cents <= 0 THEN p_cents");
    expect(body).toContain("ELSE (p_cents / 100) * 100 END");
    // The TS side it mirrors (integer cents in, integer cents out).
    expect([roundPayoutDownCents(4110), roundPayoutDownCents(4100), roundPayoutDownCents(99), roundPayoutDownCents(0), roundPayoutDownCents(-5)])
      .toEqual([4100, 4100, 0, 0, -5]);
  });

  it("inventory: every function computing a delivery take-home is known, and goes through the twin", () => {
    const defs = latestFunctionDefs(resolve(process.cwd(), "supabase/migrations"));
    const readers = [...defs.entries()]
      .filter(([name, d]) => name !== TWIN && (d.body.match(TAKE_HOME) ?? []).length > 0)
      .map(([name]) => name)
      .sort();
    expect(readers.length).toBeGreaterThan(3);
    expect(readers).toEqual(TAKE_HOME_READERS);
    for (const name of TAKE_HOME_READERS) {
      const body = defs.get(name)!.body;
      const all = (body.match(TAKE_HOME) ?? []).length;
      const wrapped = (body.match(WRAPPED) ?? []).length;
      expect(wrapped, `${name}: a take-home outside ${TWIN}`).toBe(all);
      expect(wrapped).toBeGreaterThan(0);
    }
  });

  it("the payout row's CHECK stores only the rounded amount", () => {
    const def = newestCheckBody("helpr_task_payouts_amount");
    expect(def, "no live CHECK helpr_task_payouts_amount").not.toBeNull();
    // Owner 2026-10-30 (Builder 49's 20261031014752, rebuilt as 20261031220617): the one-time setup fee, named in its own
    // column, is the only thing that may lower it.
    expect(flat(def!.body)).toBe(`amount_cents = public.${TWIN}(pay_cents - fee_cents) - setup_fee_cents AND amount_cents >= 0`);
  });

  it("helpr_task_confirm writes the rounded amount, and the notice says whole dollars", () => {
    const body = flat(newestFunction("helpr_task_confirm").body);
    expect(body).toContain(`v_amount := public.${TWIN}(t.pay_cents - t.fee_cents);`);
    expect(body).toContain("VALUES (t.id, t.helpr_id, t.pay_cents, t.fee_cents, v_amount, CASE WHEN v_amount = 0 THEN 'nothing_due' ELSE 'pending' END)");
    expect(body.split("(v_amount / 100)::text").length - 1).toBe(2);
    expect(body).not.toMatch(/FM999990\.00/);
  });

  it("the transfer is the row's own amount: payouts_due selects it, declutter-money sends it unchanged", () => {
    expect(flat(newestFunction("helpr_task_payouts_due").body)).toMatch(/^SELECT p\.id, t\.id, .*\bp\.amount_cents, pr\.stripe_account_id,/);
    const money = blankComments(readFileSync("supabase/functions/declutter-money/index.ts", "utf8"));
    // Q1929 (delivery-pay raises): the row's amount is split into per-charge parts that add up to it exactly
    // (helprPayoutParts throws otherwise), and each part is sent as it is. Q2453: a held delivery tip is one more
    // part AFTER them, its own exact amount (heldTipParts), never folded into the row's amount.
    expect(money).toMatch(/parts = \[\.\.\.helprPayoutParts\(h\.amount_cents, h\.payment_intent_id, h\.raised_cents, h\.raise_parts\), \.\.\.heldTipParts\(h\.tip_parts\)\];/);
    const leg = money.slice(money.indexOf("sent[i] = await stripe.transfers.create("));
    expect(leg.length).toBeGreaterThan(100);
    expect(leg.slice(0, 200)).toMatch(/\{\s*amount: part\.amountCents,\s*currency: "usd",/);
  });

  it("the client mirror floors the same way", () => {
    for (const pay of [1200, 1010, 4400, 4000, 50, 0, 12345, 99999]) {
      const fee = pay === 0 ? 0 : Math.min(pay, Math.round((pay * 5) / 100) + 70);
      expect(helprTakeHomeCents(pay)).toBe(roundPayoutDownCents(pay - fee));
      expect(helprTakeHomeCents(pay) % 100).toBe(0);
    }
  });
});
