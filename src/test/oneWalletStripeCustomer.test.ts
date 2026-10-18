/**
 * CLASS GUARD — one wallet (owner 2026-10-18: "verify ONCE, use EVERYWHERE";
 * plan ~/.lh-wt/handoffs-1017/one-wallet-plan.md, slice 1).
 *
 * A member has ONE stored Stripe customer per mode (public.stripe_customers),
 * reached only through supabase/functions/_shared/stripeCustomer.ts. The class
 * this guards: an edge function that mints its own Stripe customer, or finds
 * one BY EMAIL (Stripe does not treat email as a key: a member can own several
 * customers, and an address reused by a new account inherits the old customer
 * and its saved cards). Both produce a second wallet that the next section
 * cannot see, so the member is asked for a card again.
 *
 * Inventory: every tracked .ts file under supabase/functions, comments blanked.
 * The two legacy lists are EXACT in both directions: moving a function onto
 * the resolver fails until it is removed from its list (slices 2-3 of the plan
 * drive both to empty).
 *
 * @mutate supabase/functions/declutter-card/index.ts | const customerId = await resolveStripeCustomer(admin, stripe, user, mode); | const customerId = (await stripe.customers.create({ email: user.email ?? undefined })).id;
 * @mutate supabase/functions/declutter-checkout/index.ts | customerId = (await storedStripeCustomer(admin, user.id, mode)) ?? undefined; | customerId = (await stripe.customers.list({ email: user.email, limit: 1 })).data[0]?.id;
 * @mutate supabase/functions/shop-checkout/index.ts | customerId = (await storedStripeCustomer(admin, user.id, mode)) ?? undefined; | customerId = (await stripe.customers.list({ email: user.email, limit: 1 })).data[0]?.id;
 * @mutate supabase/functions/_shared/stripeCustomer.ts | .eq("wallet_mode", mode) | .eq("user_id", userId)
 * @mutate supabase/migrations/20261018090700_one_wallet_stripe_customers.sql | LANGUAGE plpgsql\nSECURITY INVOKER | LANGUAGE plpgsql\nSECURITY DEFINER
 * @mutate supabase/migrations/20261018090700_one_wallet_stripe_customers.sql | GRANT SELECT, INSERT, DELETE ON TABLE public.stripe_customers TO service_role; | GRANT ALL ON TABLE public.stripe_customers TO service_role;
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { blankComments, blankSqlComments } from "./helpers/blankNonCode";
import { readdirSync } from "./helpers/trackedFiles";

const REPO = resolve(__dirname, "../..");
const RESOLVER = "supabase/functions/_shared/stripeCustomer.ts";

/** Functions that still mint a Stripe customer themselves (plan slice 3 moves create-payment). */
// @two-way src/test/oneWalletStripeCustomer.test.ts:stale baseline entry ${f} — remove it (lower the baseline)
const LEGACY_CUSTOMER_CREATE = ["supabase/functions/create-payment/index.ts"];

/** Functions that still find a customer BY EMAIL (plan slice 3; auto-tip left in slice 0, Q2138). */
// @two-way src/test/oneWalletStripeCustomer.test.ts:stale baseline entry ${f} — remove it (lower the baseline)
const LEGACY_EMAIL_LOOKUP = [
  "supabase/functions/check-pro-subscription/index.ts",
  "supabase/functions/create-bgc-payment/index.ts",
  "supabase/functions/create-boost-payment/index.ts",
  "supabase/functions/create-gift-card-checkout/index.ts",
  "supabase/functions/create-payment/index.ts",
  "supabase/functions/create-pro-checkout/index.ts",
  "supabase/functions/pay-onboarding-fee/index.ts",
  "supabase/functions/pro-customer-portal/index.ts",
];

const edgeFiles = (readdirSync(join(REPO, "supabase/functions"), { recursive: true }) as string[])
  .map((f) => `supabase/functions/${String(f).split("\\").join("/")}`)
  .filter((f) => f.endsWith(".ts"))
  .sort();
const code = (f: string) => blankComments(readFileSync(join(REPO, f), "utf8"));

describe("one wallet: a member's Stripe customer comes from ONE place", () => {
  it("inventory is real", () => {
    expect(edgeFiles.length).toBeGreaterThan(150);
    expect(edgeFiles).toContain(RESOLVER);
  });

  const creates = (f: string) => /\bcustomers\s*\.\s*create\s*\(/.test(code(f));
  const emailLookup = (f: string) => /\bcustomers\s*\.\s*(list|search)\s*\(\s*\{[^}]*\bemail\b/.test(code(f))
    || /\bcustomers\s*\.\s*search\s*\(/.test(code(f));

  it("only the resolver (and the exact legacy list) creates Stripe customers", () => {
    const creators = edgeFiles.filter((f) => f !== RESOLVER && creates(f));
    expect(creators.filter((f) => !LEGACY_CUSTOMER_CREATE.includes(f))).toEqual([]);
    const stale = LEGACY_CUSTOMER_CREATE.filter((f) => !creators.includes(f))
      .map((f) => `stale baseline entry ${f} — remove it (lower the baseline)`);
    expect(stale).toEqual([]);
  });

  it("no function outside the exact legacy list finds a customer by email", () => {
    const lookups = edgeFiles.filter(emailLookup);
    expect(lookups.filter((f) => !LEGACY_EMAIL_LOOKUP.includes(f))).toEqual([]);
    const stale = LEGACY_EMAIL_LOOKUP.filter((f) => !lookups.includes(f))
      .map((f) => `stale baseline entry ${f} — remove it (lower the baseline)`);
    expect(stale).toEqual([]);
  });

  it("the resolver never looks a customer up by email and reads by member AND mode", () => {
    const src = code(RESOLVER);
    expect(src).not.toMatch(/customers\s*\.\s*(list|search)/);
    expect(src).toMatch(/\.from\("stripe_customers"\)[\s\S]*?\.eq\("user_id", userId\)\s*\.eq\("wallet_mode", mode\)/);
    expect(src).toMatch(/admin\.rpc\("claim_stripe_customer"/);
    // A read error throws (fail closed), never falls through to creating a second customer.
    expect(src).toMatch(/if \(error\) throw new StripeCustomerUnavailable/);
  });

  it("auto-tip charges only the poster's stored wallet customer (Q2138)", () => {
    const tip = code("supabase/functions/auto-tip-charge/index.ts");
    expect(tip).toMatch(/storedStripeCustomer\(supabase, c\.customer_id as string, mode\)/);
    expect(tip).not.toMatch(/customers\s*\.\s*(list|search)\s*\(/);
    // Only the wallet's default card, never "any card on it" (a Declutter card shares the customer).
    expect(tip).not.toMatch(/paymentMethods\s*\.\s*list\s*\(/);
    expect(tip).toMatch(/defaultCard\?\.type === "card" && defaultCardOwner === customerId/);
  });

  it("Declutter's card page and checkout use the wallet, not their own customer", () => {
    const card = code("supabase/functions/declutter-card/index.ts");
    expect(card).toMatch(/resolveStripeCustomer\(admin, stripe, user, mode\)/);
    expect(card).not.toMatch(/declutter_buyer_cards/);
    const checkout = code("supabase/functions/declutter-checkout/index.ts");
    expect(checkout).toMatch(/storedStripeCustomer\(admin, user\.id, mode\)/);
    expect(checkout).not.toMatch(/from\("declutter_buyer_cards"\)/);
  });

  it("Shops checkout uses the wallet, not Declutter's card table (owner 2026-10-18: one card everywhere)", () => {
    const shop = code("supabase/functions/shop-checkout/index.ts");
    expect(shop).toMatch(/storedStripeCustomer\(admin, user\.id, mode\)/);
    expect(shop).not.toMatch(/declutter_buyer_cards/);
  });

  it("stripe_customers is service-role only and claim_stripe_customer is an invoker, revoked from clients", () => {
    const dir = join(REPO, "supabase/migrations");
    const files = readdirSync(dir).filter((f) => f.endsWith(".sql")).sort();
    const defining = files.filter((f) => /claim_stripe_customer\s*\(/i.test(blankSqlComments(readFileSync(join(dir, f), "utf8"))));
    expect(defining.length).toBeGreaterThan(0);
    const newest = blankSqlComments(readFileSync(join(dir, defining[defining.length - 1]), "utf8"));
    const fn = newest.match(/CREATE OR REPLACE FUNCTION public\.claim_stripe_customer[\s\S]*?\nAS\s+(\$\w*\$)[\s\S]*?\1/i)?.[0] ?? "";
    expect(fn).toMatch(/SECURITY INVOKER/i);
    expect(fn).not.toMatch(/SECURITY DEFINER/i);
    expect(newest).toMatch(/REVOKE ALL ON FUNCTION public\.claim_stripe_customer\(uuid, text, text\) FROM PUBLIC, anon, authenticated;/);
    expect(newest).toMatch(/REVOKE ALL ON TABLE public\.stripe_customers FROM PUBLIC, anon, authenticated, service_role;/);
    expect(newest).toMatch(/GRANT SELECT, INSERT, DELETE ON TABLE public\.stripe_customers TO service_role;/);
    expect(newest).not.toMatch(/GRANT[^;]*\b(ALL|UPDATE)\b[^;]*ON TABLE public\.stripe_customers/i);
    expect(newest).not.toMatch(/GRANT[^;]*ON TABLE public\.stripe_customers TO[^;]*\b(anon|authenticated)\b/i);
  });
});
