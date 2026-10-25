/**
 * Which Stripe errors are a definite "no" (nothing was created, so a claim may
 * be handed back) and which may still have moved money (job 2c8480ae: a 400
 * refund refusal stranded a cancel because it was treated like a timeout).
 *
 * @mutate supabase/functions/_shared/stripeRefusal.ts |   return status >= 400 && status < 500 && status !== 409 && status !== 429; |   return status >= 400;
 * @mutate supabase/functions/_shared/stripeRefusal.ts |   if (e.type === "StripeConnectionError" \|\| e.type === "StripeAPIError" \|\| e.type === "StripeRateLimitError") return false; |   void 0;
 * @mutate supabase/functions/_shared/stripeRefusal.ts |   if (e.type === "StripeIdempotencyError" \|\| e.code === "idempotency_key_in_use") return false; |   void 0;
 * @mutate supabase/functions/_shared/stripeRefusal.ts |   if (typeof status !== "number") return false; |   if (typeof status !== "number") return true;
 */
import { describe, expect, it } from "vitest";
import { isDefinitiveStripeRefusal } from "../../supabase/functions/_shared/stripeRefusal";

const err = (fields: Record<string, unknown>) => Object.assign(new Error("x"), fields);

describe("isDefinitiveStripeRefusal", () => {
  const refusals = [
    { label: "the 2c8480ae refusal (400, invalid request)", e: err({ type: "StripeInvalidRequestError", statusCode: 400 }) },
    { label: "card declined (402)", e: err({ type: "StripeCardError", statusCode: 402 }) },
    { label: "permission (403)", e: err({ type: "StripePermissionError", statusCode: 403 }) },
    { label: "missing object (404)", e: err({ type: "StripeInvalidRequestError", statusCode: 404 }) },
  ];
  const notDefinite = [
    { label: "connection error", e: err({ type: "StripeConnectionError" }) },
    { label: "Stripe 500", e: err({ type: "StripeAPIError", statusCode: 500 }) },
    { label: "a 503 with no type", e: err({ statusCode: 503 }) },
    { label: "a 400 typed as an API error", e: err({ type: "StripeAPIError", statusCode: 400 }) },
    { label: "a 400 typed as a connection error", e: err({ type: "StripeConnectionError", statusCode: 400 }) },
    { label: "a 400 typed as a rate limit", e: err({ type: "StripeRateLimitError", statusCode: 400 }) },
    { label: "rate limit (429)", e: err({ statusCode: 429 }) },
    { label: "idempotency conflict (409)", e: err({ statusCode: 409 }) },
    { label: "idempotency error typed 400", e: err({ type: "StripeIdempotencyError", statusCode: 400 }) },
    { label: "key in use, typed 400", e: err({ type: "StripeInvalidRequestError", code: "idempotency_key_in_use", statusCode: 400 }) },
    { label: "no status at all", e: new Error("boom") },
    { label: "not an object", e: "boom" },
    { label: "null", e: null },
  ];
  it("a 4xx answer (not 409/429) is a definite refusal", () => {
    for (const c of refusals) expect(isDefinitiveStripeRefusal(c.e), c.label).toBe(true);
    expect(refusals.length).toBeGreaterThan(3);
  });
  it("anything that may still have moved money is not", () => {
    for (const c of notDefinite) expect(isDefinitiveStripeRefusal(c.e), c.label).toBe(false);
    expect(notDefinite.length).toBeGreaterThan(10);
  });
});
