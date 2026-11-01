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
 *  3. The newest CHECK helpr_task_payouts_amount stores the rounded amount less the
 *     row's own debt_cents (debt_cents >= 0, amount >= 0).
 *  4. helpr_task_confirm writes the rounded amount less the debt it took, and says it
 *     in dollars and cents.
 *
 * Q2165 (owner 2026-10-19), and BUY-36 (20261031231150): a card fee a Helpr owes for
 * a delivery that was their fault (declutter_seller_fee_debts on the Helpr) comes off
 * the next delivery payout in EXACT CENTS, after the whole-dollar rounding, so what is
 * withheld is exactly what the deduction rows book. The payout can then carry cents,
 * so the notice prints them (to_char FM999990.00). The take is capped so the order
 * part stays $1 or more after the raises (money review 10-31; the Jobs
 * helprFaultFeeCapCents rule): helprPayoutParts throws on a negative order part.
 *  5. The payout reaches Stripe as the row's own amount: helpr_task_payouts_due
 *     selects p.amount_cents and declutter-money's Helpr leg sends it unchanged.
 *  6. The client mirror (helprTakeHomeCents) floors through roundPayoutDownCents.
 */
// @mutate supabase/migrations/20261021181118_helpr_delivery_payout_round_down.sql |               ELSE (p_cents / 100) * 100 END; |               ELSE p_cents END;
// @mutate supabase/migrations/20261031231150_helpr_delivery_cant_finish.sql |   v_amount := public.helpr_payout_round_down_cents(t.pay_cents - t.fee_cents); |   v_amount := t.pay_cents - t.fee_cents;
// @mutate supabase/migrations/20261031231150_helpr_delivery_cant_finish.sql |     debt_cents >= 0 AND amount_cents = public.helpr_payout_round_down_cents(pay_cents - fee_cents) - debt_cents AND amount_cents >= 0); |     debt_cents >= 0 AND amount_cents = pay_cents - fee_cents - debt_cents AND amount_cents >= 0);
// @mutate supabase/migrations/20261031231150_helpr_delivery_cant_finish.sql |     debt_cents >= 0 AND amount_cents = public.helpr_payout_round_down_cents(pay_cents - fee_cents) - debt_cents | amount_cents = public.helpr_payout_round_down_cents(pay_cents - fee_cents) - debt_cents
// @mutate supabase/migrations/20261031075157_helpr_open_deliveries_hide_backed_out.sql |          public.helpr_payout_round_down_cents(t.pay_cents - t.fee_cents), t.open_until, t.latest_pickup_at |          t.pay_cents - t.fee_cents, t.open_until, t.latest_pickup_at
// @mutate supabase/migrations/20261031231150_helpr_delivery_cant_finish.sql | THEN public.helpr_payout_round_down_cents(t.pay_cents - t.fee_cents) END, | THEN t.pay_cents - t.fee_cents END,
// @mutate supabase/migrations/20261031231150_helpr_delivery_cant_finish.sql | ELSE format('"%s" is delivered. $%s is on its way to your payout account.', t.title, to_char(v_amount / 100.0, 'FM999990.00')) END, | ELSE format('"%s" is delivered. $%s is on its way to your payout account.', t.title, (v_amount / 100)::text) END,
// @mutate supabase/migrations/20261031231150_helpr_delivery_cant_finish.sql |   v_amount := v_amount - v_debt; |   v_amount := public.helpr_payout_round_down_cents(v_amount - v_debt);
// @mutate supabase/migrations/20261031231150_helpr_delivery_cant_finish.sql |       greatest(0, v_amount - COALESCE(t.raised_cents, 0) - 100)); |       v_amount);
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

  it("the payout row's CHECK stores the rounded amount less the row's own debt (Q2165)", () => {
    const def = newestCheckBody("helpr_task_payouts_amount");
    expect(def, "no live CHECK helpr_task_payouts_amount").not.toBeNull();
    expect(flat(def!.body)).toBe(`debt_cents >= 0 AND amount_cents = public.${TWIN}(pay_cents - fee_cents) - debt_cents AND amount_cents >= 0`);
  });

  it("helpr_task_confirm rounds first, takes the debt in exact cents (capped), and the notice says the cents (Q2165)", () => {
    const body = flat(newestFunction("helpr_task_confirm").body);
    expect(body).toContain(`v_amount := public.${TWIN}(t.pay_cents - t.fee_cents);`);
    // The debt is taken from the rounded amount, capped so the order part (after the raises) stays $1 or more.
    expect(body).toContain("v_debt := public.declutter_consume_fee_debt(t.helpr_id, 'helpr_task_' || t.id::text, greatest(0, v_amount - COALESCE(t.raised_cents, 0) - 100));");
    // Then exactly the debt comes off, never rounded again.
    expect(body).toContain("v_amount := v_amount - v_debt;");
    expect(body).not.toMatch(new RegExp(`${TWIN}\\(v_amount - v_debt\\)`));
    expect(body.indexOf(`v_amount := public.${TWIN}(`)).toBeLessThan(body.indexOf("v_amount := v_amount - v_debt;"));
    expect(body).toContain("VALUES (t.id, t.helpr_id, t.pay_cents, t.fee_cents, v_debt, v_amount, CASE WHEN v_amount = 0 THEN 'nothing_due' ELSE 'pending' END)");
    // A payout less an exact debt can carry cents, so both notices print them.
    expect(body.split("to_char(v_amount / 100.0, 'FM999990.00')").length - 1).toBe(2);
    expect(body).not.toContain("(v_amount / 100)::text");
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
