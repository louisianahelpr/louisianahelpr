/**
 * function_logs 2026-09-30T15:55:34Z: create-payment answered 500 on a
 * cancel_escrow for seed job 36eebad4 because its stored PaymentIntent was
 * minted under the Stripe TEST key and prod has run the LIVE key since 09-27:
 * "No such payment_intent: 'pi_3UK0fmKp2H4b7tEC1Srs4HSu'; a similar object
 * exists in test mode, but a live mode key was used to make this request."
 * The claim ('cancelling') had already been taken, so the 500 stranded the job.
 *
 * The CLASS: any stored Stripe object id (payment intent, checkout session,
 * customer, ...) that turns out to be a test-mode object under the live key is
 * classified by one shared function, and create-payment never answers 500 for
 * it. Behaviour per path is pinned in create-payment.test.ts; this pins the
 * classifier on Stripe's exact sentence and that the function's outer catch
 * routes through it.
 *
 * @mutate supabase/functions/_shared/stripeAccountUsable.ts | /a similar object exists in test mode, but a live mode key was used/ | /a similar object exists in (test\|live) mode/
 * @mutate supabase/functions/create-payment/index.ts | import { isTestObjectUnderLiveKey } from "../_shared/stripeAccountUsable.ts"; | const isTestObjectUnderLiveKey = (_e: unknown) => false;
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { blankComments } from "../helpers/blankNonCode";
import { isTestObjectUnderLiveKey } from "../../../supabase/functions/_shared/stripeAccountUsable";

const REPO = resolve(__dirname, "../../..");
const code = (p: string) => blankComments(readFileSync(resolve(REPO, p), "utf8"));

describe("a Stripe test-mode object read under the live key is classified, never a 500", () => {
  it("classifies the exact error from prod function_logs", () => {
    const live = Object.assign(
      new Error(
        "No such payment_intent: 'pi_3UK0fmKp2H4b7tEC1Srs4HSu'; a similar object exists in test mode, but a live mode key was used to make this request.",
      ),
      { type: "StripeInvalidRequestError", code: "resource_missing", statusCode: 404 },
    );
    expect(isTestObjectUnderLiveKey(live)).toBe(true);
    expect(
      isTestObjectUnderLiveKey({
        message: "No such checkout.session: 'cs_test_a1'; a similar object exists in test mode, but a live mode key was used to make this request.",
      }),
    ).toBe(true);
  });

  it("does NOT classify a live object under a test key (a key misconfig, real money behind it)", () => {
    expect(
      isTestObjectUnderLiveKey({
        message: "No such payment_intent: 'pi_1'; a similar object exists in live mode, but a test mode key was used to make this request.",
      }),
    ).toBe(false);
  });

  it("does NOT swallow a plain missing object or any ordinary failure", () => {
    expect(isTestObjectUnderLiveKey({ code: "resource_missing", statusCode: 404, message: "No such payment_intent: 'pi_1'" })).toBe(false);
    expect(isTestObjectUnderLiveKey({ statusCode: 429, message: "Too many requests" })).toBe(false);
    expect(isTestObjectUnderLiveKey(new Error("fetch failed"))).toBe(false);
    expect(isTestObjectUnderLiveKey(null)).toBe(false);
    expect(isTestObjectUnderLiveKey("a similar object exists in test mode, but a live mode key was used")).toBe(false);
  });

  it("create-payment's outer catch maps it to a 409 before the generic 500", () => {
    const s = code("supabase/functions/create-payment/index.ts");
    const at = s.indexOf("if (isTestObjectUnderLiveKey(error)) {");
    expect(at, "the outer catch checks the classifier").toBeGreaterThan(-1);
    const the500 = s.indexOf("status: 500", at);
    expect(s.slice(at, the500)).toMatch(/status: 409/);
  });
});
