import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

/**
 * CLASS: a money door must not open a Stripe Checkout Session it cannot later
 * account for.
 *
 * The defect this guards (H-2): `create-gift-card-checkout` did exactly ONE
 * database operation in its whole body — a `profiles` read — and wrote nothing.
 * A gift purchase therefore left NO row of any kind until the webhook landed, so
 * a lost webhook delivery (or a signature failure, which `stripe-webhook`
 * deliberately answers 200) meant the donor was charged and there was nothing
 * queryable anywhere: no row, no reconciliation target, no support path. `jobs`
 * stamps `stripe_session_id` at checkout-open precisely so a lost session is
 * detectable; gifts had no equivalent.
 *
 * The invariant has three halves, and all three are asserted here, because any
 * one of them alone is unsafe:
 *
 *   1. the gift row is pre-registered `payment_status='pending'` carrying the
 *      session id, BEFORE the donor can reach a payment page;
 *   2. the webhook UPSERTS on that session id — completing the pending row
 *      rather than blind-inserting a duplicate beside it; and
 *   3. an abandoned (expired) session closes its own pre-registration out, so a
 *      row still reading pending long after a session's ~24h life is
 *      unambiguously the money-in-no-credit case rather than a harmless
 *      abandonment.
 *
 * Every assertion below is anchored on CONTENT — identifier and string tokens —
 * and never on indentation or line breaks, so reformatting the sources cannot
 * silently rot this guard into vacuity.
 */

const root = resolve(__dirname, "../../..");
const read = (p: string) => readFileSync(resolve(root, p), "utf8");

const CHECKOUT = "supabase/functions/create-gift-card-checkout/index.ts";
const COMPLETED = "supabase/functions/stripe-webhook/handlers/checkoutSessionCompleted.ts";
const EXPIRED = "supabase/functions/stripe-webhook/handlers/checkoutSessionExpired.ts";

describe("gift checkout pre-registers its Stripe session", () => {
  // @mutate supabase/functions/create-gift-card-checkout/index.ts | payment_status: "pending", | payment_status: "paid",
  it("writes a pending gift_cards row carrying stripe_session_id before returning a payable URL", () => {
    const src = read(CHECKOUT);

    // The write must exist, target gift_cards, carry the session id, and be
    // pending — a pre-registration that is already 'paid' would be spendable
    // credit minted for a charge that has not happened.
    const preRegister =
      /\.from\(\s*["']gift_cards["']\s*\)[\s\S]{0,1200}?stripe_session_id:\s*session\.id/;
    expect(
      preRegister.test(src),
      `${CHECKOUT} must insert a gift_cards row carrying stripe_session_id: session.id. ` +
        "Without it a lost webhook leaves a charged donor with nothing queryable.",
    ).toBe(true);

    expect(
      /\.from\(\s*["']gift_cards["']\s*\)[\s\S]{0,1200}?payment_status:\s*["']pending["']/.test(src),
      `${CHECKOUT} must pre-register the gift as payment_status: "pending". ` +
        "Every spend path gates on 'paid', so 'pending' is what keeps the row inert until the charge is confirmed.",
    ).toBe(true);

    // A null `error` is not a write: the pre-registration must ask for rows back.
    expect(
      /\.from\(\s*["']gift_cards["']\s*\)[\s\S]{0,1400}?\.select\(\s*["']id["']\s*\)/.test(src),
      `${CHECKOUT} must .select("id") on the pre-registration so a zero-row write is detectable.`,
    ).toBe(true);

    // And it must fail CLOSED — the donor must never get a checkout URL we could
    // not record. The pre-registration therefore has to sit between the session
    // create and the response that hands back session.url.
    const sessionCreate = src.indexOf("checkout.sessions.create");
    const preRegisterAt = src.search(preRegister);
    const respond = src.indexOf("url: session.url");
    expect(sessionCreate, "expected a checkout.sessions.create in this function").toBeGreaterThan(-1);
    expect(respond, "expected this function to return session.url").toBeGreaterThan(-1);
    expect(
      preRegisterAt > sessionCreate && preRegisterAt < respond,
      "the gift_cards pre-registration must happen after the Checkout Session is created " +
        "(it needs the session id) and before the payable URL is returned to the donor.",
    ).toBe(true);
  });

  // @mutate supabase/functions/stripe-webhook/handlers/checkoutSessionCompleted.ts | const { data: minted, error: mintErr } = existing | const { data: minted, error: mintErr } = false
  it("completes the pending row on the webhook instead of inserting a duplicate beside it", () => {
    const src = read(COMPLETED);

    // The mint must branch on whether a row for this session already exists.
    // A bare .insert() beside a pre-registered row would either collide on
    // gift_cards_stripe_session_id_unique_idx (gift permanently undelivered) or,
    // if that index were ever dropped, double-mint.
    expect(
      /const\s*\{\s*data:\s*minted,\s*error:\s*mintErr\s*\}\s*=\s*existing/.test(src),
      `${COMPLETED} must upsert on stripe_session_id — completing the pre-registered row when one ` +
        "exists — not unconditionally insert.",
    ).toBe(true);

    // The completion must only ever move a row that is still pending, so a
    // concurrent delivery cannot re-notify or re-email an already-minted gift.
    expect(
      /\.update\(\s*mintRow\s*\)[\s\S]{0,400}?\.eq\(\s*["']payment_status["']\s*,\s*["']pending["']\s*\)/.test(src),
      `${COMPLETED} must guard the completion with .eq("payment_status", "pending").`,
    ).toBe(true);

    // ...and must treat zero matched rows as "someone else already did it",
    // never as success worth emailing about again.
    expect(
      /!minted\s*\|\|\s*minted\.length\s*===\s*0/.test(src),
      `${COMPLETED} must handle the zero-row case explicitly — a null error is not a write.`,
    ).toBe(true);
  });

  // @mutate supabase/functions/stripe-webhook/handlers/checkoutSessionExpired.ts | === "gift_card_purchase" | === "not_a_gift_purchase"
  it("closes out the pre-registration when the donor abandons checkout", () => {
    const src = read(EXPIRED);

    expect(
      /===\s*["']gift_card_purchase["']/.test(src),
      `${EXPIRED} must recognise an abandoned gift PURCHASE, not only a gift-funded difference checkout. ` +
        "Otherwise every abandoned gift leaves a pending row forever and the query that finds real " +
        "money-in-no-credit losses drowns in them.",
    ).toBe(true);

    expect(
      /\.update\(\s*\{[^}]*status:\s*["']expired["'][^}]*\}\s*\)[\s\S]{0,400}?\.eq\(\s*["']payment_status["']\s*,\s*["']pending["']\s*\)/.test(src),
      `${EXPIRED} must expire only a still-pending pre-registration — never a gift that actually got paid.`,
    ).toBe(true);
  });
});
