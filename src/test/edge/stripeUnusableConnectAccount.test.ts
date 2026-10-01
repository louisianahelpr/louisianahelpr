/**
 * #1582 — press-every-control run 36697559350 (2026-09-30): 216 of 227 press
 * failures were stripe-connect / stripe-payouts answering 500 on page load.
 * function_logs, verbatim: "The account acct_1UCU7J4HVr518r7O was a test
 * account created with a testmode key, and therefore can only be used with
 * testmode keys." (StripeAPIError, status 400). The shared E2E accounts still
 * point at sandbox Connect accounts; prod's key has been live since 09-27.
 *
 * The CLASS: any Stripe answer meaning "this Connect account cannot be used at
 * all" must be classified as such by BOTH functions that read the account on
 * a page load — never a 500. This pins the classifier on the exact message
 * Stripe sent, and pins that each function routes its Stripe calls through it.
 *
 * @mutate supabase/functions/_shared/stripeAccountUsable.ts | e.code === "resource_missing" \|\|\n    /test account created with a testmode key, and therefore can only be used with testmode keys/.test(message) | e.code === "resource_missing"
 * @mutate supabase/functions/_shared/stripeAccountUsable.ts | /test account created with a testmode key, and therefore can only be used with testmode keys/ | /can only be used with (test\|live)mode keys/
 * @mutate supabase/functions/stripe-payouts/index.ts | if (!isUnusableConnectAccountError(stripeErr)) throw stripeErr; | throw stripeErr;
 * @mutate supabase/functions/stripe-connect/index.ts | const isStaleAccountErr = isUnusableConnectAccountError(err); | const isStaleAccountErr = err.statusCode === 404;
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { blankComments } from "../helpers/blankNonCode";
import { isUnusableConnectAccountError } from "../../../supabase/functions/_shared/stripeAccountUsable";

const REPO = resolve(__dirname, "../../..");
const src = (p: string) => readFileSync(resolve(REPO, p), "utf8");

// Blank comments so a mention in prose never satisfies a code assertion.
const code = (p: string) => blankComments(src(p));

describe("unusable Stripe Connect account is classified, never a 500 (#1582)", () => {
  it("classifies the exact live-key / testmode-account error from prod function_logs", () => {
    const live = Object.assign(
      new Error(
        "The account acct_1UCU7J4HVr518r7O was a test account created with a testmode key, and therefore can only be used with testmode keys.",
      ),
      { statusCode: 400, type: "StripeInvalidRequestError" },
    );
    expect(isUnusableConnectAccountError(live)).toBe(true);
  });

  it("does NOT classify a live account under a test key (a key misconfig) as unusable", () => {
    // Clearing on this would null every real helper's live account id if prod's
    // key were ever set back to sk_test_ (lh-money-escrow review, 2026-09-30).
    expect(
      isUnusableConnectAccountError({
        statusCode: 400,
        message:
          "The account acct_1Abc was a live account created with a livemode key, and therefore can only be used with livemode keys.",
      }),
    ).toBe(false);
  });

  it("keeps the pre-existing stale-account signals", () => {
    expect(isUnusableConnectAccountError({ statusCode: 404, message: "x" })).toBe(true);
    expect(isUnusableConnectAccountError({ message: "No such account: 'acct_x'" })).toBe(true);
    expect(isUnusableConnectAccountError({ code: "account_invalid" })).toBe(true);
    expect(isUnusableConnectAccountError({ code: "resource_missing" })).toBe(true);
  });

  it("does NOT swallow ordinary failures (rate limit, auth, network, a plain 400)", () => {
    expect(isUnusableConnectAccountError({ statusCode: 429, message: "Too many requests" })).toBe(false);
    expect(isUnusableConnectAccountError({ statusCode: 401, message: "Invalid API Key provided" })).toBe(false);
    expect(isUnusableConnectAccountError({ statusCode: 400, message: "Invalid integer: abc" })).toBe(false);
    expect(isUnusableConnectAccountError(new Error("fetch failed"))).toBe(false);
    expect(isUnusableConnectAccountError(null)).toBe(false);
  });

  it("stripe-payouts answers not-connected for an unusable account and rethrows anything else", () => {
    const s = code("supabase/functions/stripe-payouts/index.ts");
    const catchAt = s.indexOf("} catch (stripeErr) {");
    expect(catchAt, "the Stripe reads are wrapped in their own catch").toBeGreaterThan(-1);
    const block = s.slice(catchAt, s.indexOf("const [account, balance, payoutsList] = fetched;", catchAt));
    expect(block).toContain("if (!isUnusableConnectAccountError(stripeErr)) throw stripeErr;");
    expect(block).toMatch(/return new Response\(JSON\.stringify\(empty\)/);
    // The retrieve must sit inside that try, not before it.
    const tryAt = s.lastIndexOf("try {", catchAt);
    expect(s.slice(tryAt, catchAt)).toContain("stripe.accounts.retrieve(accountId)");
  });

  it("stripe-connect's stale-account recovery uses the shared classifier", () => {
    const s = code("supabase/functions/stripe-connect/index.ts");
    expect(s).toContain("const isStaleAccountErr = isUnusableConnectAccountError(err);");
    expect(s).toMatch(/if \(isStaleAccountErr\) \{[\s\S]{0,1500}status: 409/);
  });
});
