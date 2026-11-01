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
 * @mutate supabase/functions/declutter-card/index.ts | const customerId = await resolveStripeCustomer(admin, stripe, user, mode, { adoptTagged: true }); | const customerId = (await stripe.customers.create({ email: user.email ?? undefined })).id;
 * @mutate supabase/functions/declutter-checkout/index.ts | customerId = (await storedStripeCustomer(admin, user.id, mode)) ?? undefined; | customerId = (await stripe.customers.list({ email: user.email, limit: 1 })).data[0]?.id;
 * @mutate supabase/functions/shop-checkout/index.ts | customerId = (await storedStripeCustomer(admin, user.id, mode)) ?? undefined; | customerId = (await stripe.customers.list({ email: user.email, limit: 1 })).data[0]?.id;
 * @mutate supabase/functions/_shared/stripeCustomer.ts | .eq("wallet_mode", mode) | .eq("user_id", userId)
 * @mutate supabase/migrations/20261018090700_one_wallet_stripe_customers.sql | LANGUAGE plpgsql\nSECURITY INVOKER | LANGUAGE plpgsql\nSECURITY DEFINER
 * @mutate supabase/migrations/20261018090700_one_wallet_stripe_customers.sql | GRANT SELECT, INSERT, DELETE ON TABLE public.stripe_customers TO service_role; | GRANT ALL ON TABLE public.stripe_customers TO service_role;
 * @mutate supabase/functions/_shared/stripeCustomer.ts | query: `metadata['supabase_user_id']:'${userId}'` | query: `email:'${userId}'`
 * @mutate supabase/functions/pro-customer-portal/index.ts |     let customerId: string \| null = null; |     let customerId: string \| null = (await stripe.customers.list({ email: user.email, limit: 1 })).data[0]?.id ?? null;
 * @mutate supabase/functions/pro-customer-portal/index.ts |     const portalSession = await stripe.billingPortal.sessions.create({ |     await stripe.customers.update(customerId, { invoice_settings: { default_payment_method: "pm_x" } });\n    const portalSession = await stripe.billingPortal.sessions.create({
 * @mutate supabase/migrations/20261018160108_declutter_card_notice_one_wallet.sql | 'Your card is saved. It is charged only when you buy, or automatically where you turned on automatic charges.' | 'Your card is saved for Declutter. It is never charged until you check out and pay.'
 * @mutate src/components/declutter/DeclutterOfferPanel.tsx | We save your card now; you're only charged when you check out. | We save your card now; your card is never charged until you check out and pay.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { blankComments, blankSqlComments } from "./helpers/blankNonCode";
import { readdirSync, trackedFiles } from "./helpers/trackedFiles";

const REPO = resolve(__dirname, "../..");
const RESOLVER = "supabase/functions/_shared/stripeCustomer.ts";

/** Functions that still mint a Stripe customer themselves (create-payment moved onto the wallet in Q2139). */
// @two-way src/test/oneWalletStripeCustomer.test.ts:stale baseline entry ${f} — remove it (lower the baseline)
const LEGACY_CUSTOMER_CREATE: string[] = [];

/**
 * Edge functions that set a Stripe customer's DEFAULT card (invoice_settings.default_payment_method).
 * That default is the off-session consent auto-tip charges (Q2138), so only the wallet save-card
 * path may set it in our code: _walletDefaultCard.ts, called by BOTH save paths (Jobs' "save card for
 * next time" and Declutter's card page; the most recently saved card in any section wins, owner
 * 2026-10-18, Q2139). Exact, both directions. Outside our code, the
 * Stripe Billing Portal can set it too when a member's Pro subscription sits on their wallet
 * customer: the member choosing their own wallet card (one wallet card everywhere, owner 2026-10-18).
 */
// @two-way src/test/oneWalletStripeCustomer.test.ts:stale default-card setter ${f} — remove it (lower the baseline)
const DEFAULT_CARD_SETTERS = ["supabase/functions/stripe-webhook/handlers/_walletDefaultCard.ts"];

/** Functions that still find a customer BY EMAIL (plan slice 3; auto-tip left in slice 0, Q2138). */
// @two-way src/test/oneWalletStripeCustomer.test.ts:stale baseline entry ${f} — remove it (lower the baseline)
const LEGACY_EMAIL_LOOKUP = [
  "supabase/functions/check-pro-subscription/index.ts",
  "supabase/functions/create-pro-checkout/index.ts",
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
  // A search counts as a lookup unless its query is the exact supabase_user_id metadata tag (Q2139 adoption).
  const searchNotByTag = (src: string) => [...src.matchAll(/\bcustomers\s*\.\s*search\s*\??\.?\s*\(([^;]*)/g)]
    .some((m) => !/^\s*\{\s*query:\s*`metadata\['supabase_user_id'\]:'\$\{userId\}'`/.test(m[1]));
  const emailLookup = (f: string) => /\bcustomers\s*\.\s*(list|search)\s*\(\s*\{[^}]*\bemail\b/.test(code(f))
    || searchNotByTag(code(f));

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
    expect(src).not.toMatch(/customers\s*\.\s*list/);
    // Adoption (Q2139) searches only by the exact supabase_user_id tag and re-checks it on every result.
    expect(searchNotByTag(src)).toBe(false);
    expect(src).toMatch(/c\.metadata\?\.supabase_user_id === userId/);
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
    expect(card).toMatch(/resolveStripeCustomer\(admin, stripe, user, mode, \{ adoptTagged: true \}\)/);
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

  it("only the wallet save-card path sets a customer's default card (Q2141)", () => {
    // An object literal, a form-encoded key, or any customers.update that carries invoice_settings
    // (an object built beforehand) all count (lh-money-escrow review of 2340db8b7 #3).
    const setsDefault = (src: string) => /invoice_settings\s*:\s*\{[^}]*\bdefault_payment_method\b/.test(src)
      || /invoice_settings\[default_payment_method\]/.test(src)
      || /customers\s*\.\s*update\s*\([^;]*\binvoice_settings\b/.test(src);
    const setters = edgeFiles.filter((f) => setsDefault(code(f)));
    expect(setters.filter((f) => !DEFAULT_CARD_SETTERS.includes(f))).toEqual([]);
    const stale = DEFAULT_CARD_SETTERS.filter((f) => !setters.includes(f))
      .map((f) => `stale default-card setter ${f} — remove it (lower the baseline)`);
    expect(stale).toEqual([]);
  });

  it("the Pro billing portal opens only on a customer that carries a subscription, never the first one found (Q2141)", () => {
    const portalOpeners = edgeFiles.filter((f) => /billingPortal\s*\.\s*sessions\s*\.\s*create\s*\(/.test(code(f)));
    expect(portalOpeners).toEqual(["supabase/functions/pro-customer-portal/index.ts"]);
    const portal = code(portalOpeners[0]);
    expect(portal).not.toMatch(/customers\.data\[0\]/);
    // Q2142: the customer the member's subscription names, read by user id; never by email.
    expect(portal).not.toMatch(/customers\s*\.\s*(list|search)\s*\(/);
    expect(portal).toMatch(/\.select\("stripe_customer_id"\)\s*\.eq\("user_id", user\.id\)/);
    expect(portal).toMatch(/let customerId: string \| null = null;/);
    expect(portal).toMatch(/if \(!customerId\) \{[\s\S]{0,200}?status: 404/);
  });
});

describe("one wallet: no screen promises a saved card is never charged automatically (owner 2026-10-18)", () => {
  // ONE WALLET CARD EVERYWHERE: a member's default saved card may be charged automatically wherever they
  // turned on automatic charges (auto-tip, recurring). "Never charged until you check out" is no longer true.
  const appFiles = trackedFiles("src")
    .filter((f) => /\.(ts|tsx)$/.test(f) && !/\.test\.(ts|tsx)$/.test(f) && !f.startsWith("src/test/"));

  it("inventory is real", () => {
    expect(appFiles.length).toBeGreaterThan(500);
    expect(appFiles).toContain("src/components/declutter/DeclutterTradeViews.tsx");
  });

  it("no app copy says a card is never charged until checkout, or never charged automatically", () => {
    const promise = /never (be )?charged (until you (check ?out|pay)|automatically)/i;
    expect(appFiles.filter((f) => promise.test(blankComments(readFileSync(join(REPO, f), "utf8"))))).toEqual([]);
  });

  it("the newest declutter_save_card sends the one-wallet notice, not \"never charged\"", () => {
    const dir = join(REPO, "supabase/migrations");
    const defining = readdirSync(dir).filter((f) => f.endsWith(".sql")).sort()
      .filter((f) => /FUNCTION public\.declutter_save_card\s*\(/i.test(blankSqlComments(readFileSync(join(dir, f), "utf8"))));
    expect(defining.length).toBeGreaterThan(1);
    const newest = blankSqlComments(readFileSync(join(dir, defining[defining.length - 1]), "utf8"));
    expect(newest).not.toMatch(/never charged/i);
    expect(newest).toMatch(/charged only when you buy, or automatically where you turned on automatic charges/);
  });
});
