/**
 * Ease batch (owner-approved 2026-11-20): Declutter buyers can pay with Apple Pay and Google Pay on Stripe's page.
 *
 * Why it works today (checked 2026-11-20, read-only):
 *   - Stripe docs (Checkout, "Apple Pay and Google Pay"): Checkout shows both wallets as part of the card method when
 *     they are on in the account's payment method settings; listing "card" in payment_method_types is how wallets are
 *     asked for by hand. Domain registration is listed for EMBEDDED Checkout only: our pages are Stripe-hosted
 *     (checkout.stripe.com), so no domain step. On the app the page opens in SFSafariViewController (openExternalUrl).
 *   - Live read of the account's own default payment method configuration (pmc_1RQbBF..., application null):
 *     card on, apple_pay available + on, google_pay available + on (src/lib/walletsLive.ts records it).
 * So the one thing our code could do to lose them is ask Checkout for a page without card, hide the wallets in
 * wallet_options, or pin a payment method configuration that has them off. This guard reads every
 * checkout.sessions.create in declutter-checkout and fails on any of those.
 *
 * @mutate supabase/functions/declutter-checkout/index.ts |       wallet_options: { link: { display: "never" } },\n      line_items: lineItems, |       wallet_options: { link: { display: "never" }, apple_pay: { display: "never" } },\n      line_items: lineItems,
 * @mutate supabase/functions/declutter-checkout/index.ts |       payment_method_types: ["card"],\n      wallet_options: { link: { display: "never" } },\n      // One line | payment_method_types: ["us_bank_account"],\n      wallet_options: { link: { display: "never" } },\n      // One line
 * @mutate supabase/functions/_shared/tipFees.ts | export const TIP_PAYMENT_METHOD_TYPES: ("card" \| "link")[] = ["card", "link"]; | export const TIP_PAYMENT_METHOD_TYPES: ("card" \| "link")[] = ["link"];
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { blankComments } from "@/test/helpers/blankNonCode";
import { LIVE_WALLETS } from "@/lib/walletsLive";

const read = (f: string) => blankComments(readFileSync(join(process.cwd(), f), "utf8"));

/** Each `stripe.checkout.sessions.create(` call's argument text, to its matching close paren. */
function sessionCreates(src: string): string[] {
  const out: string[] = [];
  const re = /checkout\.sessions\.create\(/g;
  for (let m = re.exec(src); m; m = re.exec(src)) {
    let depth = 1;
    let i = m.index + m[0].length;
    for (; i < src.length && depth > 0; i++) {
      if (src[i] === "(") depth++;
      else if (src[i] === ")") depth--;
    }
    out.push(src.slice(m.index, i));
  }
  return out;
}

describe("Declutter checkout never hides Apple Pay or Google Pay", () => {
  const src = read("supabase/functions/declutter-checkout/index.ts");
  const calls = sessionCreates(src);
  const tipTypes = read("supabase/functions/_shared/tipFees.ts").match(/export const TIP_PAYMENT_METHOD_TYPES[^=]*=\s*(\[[^\]]*\])/)?.[1] ?? "";

  it("every Stripe page it opens offers card (the wallets ride on card)", () => {
    expect(calls.length).toBeGreaterThan(2);
    for (const call of calls) {
      const types = call.match(/payment_method_types:\s*([^,\n]+)/)?.[1]?.trim() ?? "";
      const list = types === "TIP_PAYMENT_METHOD_TYPES" ? tipTypes : types;
      expect(list, call.slice(0, 120)).toMatch(/["']card["']/);
    }
  });

  it("no page hides a wallet or pins a payment method configuration that could turn them off", () => {
    for (const call of calls) {
      expect(call).not.toMatch(/apple_pay|google_pay/);
      expect(call).not.toMatch(/payment_method_configuration/);
      // wallet_options may hide Link only (audit 2026-10-28 #22), never a card wallet.
      for (const w of call.matchAll(/wallet_options:\s*\{([^}]*\}?)\s*\}/g)) expect(w[1].replace(/link:\s*\{[^}]*\}/, "").replace(/[\s,]/g, "")).toBe("");
    }
  });

  it("the live wallets record still names both (a fresh live read is what changes it)", () => {
    expect([...LIVE_WALLETS]).toEqual(["Apple Pay", "Google Pay"]);
  });
});
