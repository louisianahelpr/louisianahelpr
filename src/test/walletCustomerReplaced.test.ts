/**
 * Q2140: a member's stored wallet customer that Stripe no longer has (deleted in the Dashboard, test data wiped) is
 * replaced ONCE and the call retried, lazily: no extra Stripe call on the happy path (lead 11-02, nothing slow).
 * The real module (_shared/stripeCustomer.ts has zero imports) against a fake service client and Stripe.
 * The swap itself (guarded on the dead id, dead Declutter card deleted, service_role only):
 * src/test/pglite/replaceDeadStripeCustomer.pglite.mjs.
 *
 * @mutate supabase/functions/_shared/stripeCustomer.ts |     if (!isMissingCustomerError(err, customerId)) throw err; |     throw err;
 * @mutate supabase/functions/_shared/stripeCustomer.ts |   if (code !== "resource_missing") return false; |   if (!code) return false;
 * @mutate supabase/functions/_shared/stripeCustomer.ts |     return await fn(data, true); |     return await fn(data, false);
 * @mutate supabase/functions/_shared/stripeCustomer.ts |     if (error) throw new StripeCustomerUnavailable(`wallet replace failed: ${error.message}`); |     if (error) return await fn(customerId, true);
 * @mutate supabase/functions/_shared/stripeCustomer.ts |         { idempotencyKey: `lh-wallet-customer-${user.id}-${mode}-after-${customerId}` }, |         { idempotencyKey: `lh-wallet-customer-${user.id}-${mode}` },
 * @mutate supabase/functions/_shared/stripeCustomer.ts |   if (!customerId) return await fn(undefined, false); |   if (!customerId) return await fn(undefined, true);
 * @mutate supabase/functions/declutter-checkout/index.ts | await withStoredWalletCustomer(admin, stripe, user, mode, payerCustomer, (payer, walletRetry) => stripe.checkout.sessions.create({ | await stripe.checkout.sessions.create({
 * @mutate supabase/functions/declutter-card/index.ts | withWalletCustomer(admin, stripe, user, mode, (customerId) => stripe.checkout.sessions.create( | ((_a: unknown, _b: unknown, _c: unknown, _d: unknown, f: (c: string) => unknown) => f("cus_x"))(admin, stripe, user, mode, (customerId) => stripe.checkout.sessions.create(
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { StripeCustomerUnavailable, withStoredWalletCustomer, withWalletCustomer } from "../../supabase/functions/_shared/stripeCustomer";
import { blankComments } from "./helpers/blankNonCode";

const USER = { id: "00000000-0000-0000-0000-0000000000aa", email: "a@example.com" };

function world(opts: { replaceError?: string } = {}) {
  const calls: { rpc: Array<[string, Record<string, unknown>]>; created: Array<{ key?: string }> } = { rpc: [], created: [] };
  let stored = "cus_dead";
  const admin = {
    from: () => ({
      select: () => ({ eq: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { stripe_customer_id: stored }, error: null }) }) }) }),
    }),
    rpc: async (fn: string, args: Record<string, unknown>) => {
      calls.rpc.push([fn, args]);
      if (opts.replaceError) return { data: null, error: { message: opts.replaceError } };
      if (fn === "replace_stripe_customer" && args.p_old === stored) stored = String(args.p_new);
      return { data: stored, error: null };
    },
  };
  const stripe = {
    customers: {
      create: async (_p: unknown, o?: { idempotencyKey?: string }) => {
        calls.created.push({ key: o?.idempotencyKey });
        return { id: "cus_fresh" };
      },
    },
  };
  return { admin, stripe, calls };
}
const missing = (id: string) => Object.assign(new Error(`No such customer: '${id}'`), { code: "resource_missing", param: "customer" });

describe("Q2140: withWalletCustomer replaces a customer Stripe no longer has, once", () => {
  it("happy path: one call with the stored id, no Stripe customer call, no replace", async () => {
    const w = world();
    const seen: Array<[string, boolean]> = [];
    const out = await withWalletCustomer(w.admin, w.stripe, USER, "test", async (c, retry) => (seen.push([c, retry]), "session"));
    expect(out).toBe("session");
    expect(seen).toEqual([["cus_dead", false]]);
    expect(w.calls.created).toEqual([]);
    expect(w.calls.rpc).toEqual([]);
  });

  it("resource_missing for the customer: a new customer, the guarded swap, and ONE retry flagged as such", async () => {
    const w = world();
    const seen: Array<[string, boolean]> = [];
    const out = await withWalletCustomer(w.admin, w.stripe, USER, "test", async (c, retry) => {
      seen.push([c, retry]);
      if (c === "cus_dead") throw missing(c);
      return "session";
    });
    expect(out).toBe("session");
    expect(seen).toEqual([["cus_dead", false], ["cus_fresh", true]]);
    expect(w.calls.created).toEqual([{ key: `lh-wallet-customer-${USER.id}-test-after-cus_dead` }]);
    expect(w.calls.rpc).toEqual([["replace_stripe_customer", { p_user: USER.id, p_mode: "test", p_old: "cus_dead", p_new: "cus_fresh" }]]);
  });

  it("the retry fails the same way: it is not retried again", async () => {
    const w = world();
    let n = 0;
    await expect(withWalletCustomer(w.admin, w.stripe, USER, "test", async (c) => { n++; throw missing(c); })).rejects.toThrow(/No such customer/);
    expect(n).toBe(2);
  });

  it("any other Stripe error is rethrown as it was, with no replace", async () => {
    const w = world();
    const other = Object.assign(new Error("No such price"), { code: "resource_missing", param: "line_items[0][price]" });
    await expect(withWalletCustomer(w.admin, w.stripe, USER, "test", async () => { throw other; })).rejects.toBe(other);
    const card = Object.assign(new Error("declined"), { code: "card_declined" });
    await expect(withWalletCustomer(w.admin, w.stripe, USER, "test", async () => { throw card; })).rejects.toBe(card);
    // Names the customer, but is not resource_missing (a key or rate problem): not a lost customer.
    const keyErr = Object.assign(new Error("No such customer: 'cus_dead'"), { code: "api_key_expired", param: "customer" });
    await expect(withWalletCustomer(w.admin, w.stripe, USER, "test", async () => { throw keyErr; })).rejects.toBe(keyErr);
    expect(w.calls.created).toEqual([]);
    expect(w.calls.rpc).toEqual([]);
  });

  it("a failed swap answers 'try again' (StripeCustomerUnavailable), never runs on the dead id again", async () => {
    const w = world({ replaceError: "boom" });
    let n = 0;
    await expect(withWalletCustomer(w.admin, w.stripe, USER, "test", async (c) => { n++; throw missing(c); })).rejects.toBeInstanceOf(StripeCustomerUnavailable);
    expect(n).toBe(1);
  });

  it("pre-fill callers: none stored -> one call with undefined and nothing made; a dead stored one is replaced and retried once", async () => {
    const w = world();
    const seen: Array<[string | undefined, boolean]> = [];
    expect(await withStoredWalletCustomer(w.admin, w.stripe, USER, "test", undefined, async (c, retry) => (seen.push([c, retry]), "page"))).toBe("page");
    expect(seen).toEqual([[undefined, false]]);
    expect(w.calls.created).toEqual([]);
    expect(w.calls.rpc).toEqual([]);

    const out = await withStoredWalletCustomer(w.admin, w.stripe, USER, "test", "cus_dead", async (c, retry) => {
      seen.push([c, retry]);
      if (c === "cus_dead") throw missing(c);
      return "page";
    });
    expect(out).toBe("page");
    expect(seen.slice(1)).toEqual([["cus_dead", false], ["cus_fresh", true]]);
    expect(w.calls.rpc).toEqual([["replace_stripe_customer", { p_user: USER.id, p_mode: "test", p_old: "cus_dead", p_new: "cus_fresh" }]]);
  });

  it("every pre-fill page (declutter order, raise, tip; shop order) runs through withStoredWalletCustomer with a ':new-wallet' retry key", () => {
    const pages: Record<string, number> = { "declutter-checkout": 3, "shop-checkout": 1 };
    for (const [fn, n] of Object.entries(pages)) {
      const src = blankComments(readFileSync(`supabase/functions/${fn}/index.ts`, "utf8"));
      expect(src.match(/storedStripeCustomer\(/g)?.length, fn).toBe(n);
      expect(src.match(/withStoredWalletCustomer\(admin, stripe, user, mode, /g)?.length, fn).toBe(n);
      expect(src.match(/\$\{walletRetry \? ":new-wallet" : ""\}`/g)?.length, fn).toBe(n);
    }
    expect(Object.keys(pages).length).toBeGreaterThan(1);
  });

  it("every wallet Checkout caller goes through withWalletCustomer, none resolves the id itself", () => {
    const callers = ["create-payment", "declutter-card", "create-bgc-payment", "create-boost-payment", "create-gift-card-checkout", "pay-onboarding-fee"];
    for (const fn of callers) {
      const src = blankComments(readFileSync(`supabase/functions/${fn}/index.ts`, "utf8"));
      expect(src, fn).toMatch(/withWalletCustomer\(/);
      expect(src, fn).not.toMatch(/resolveStripeCustomer\(/);
    }
    expect(callers.length).toBeGreaterThan(5);
  });
});
