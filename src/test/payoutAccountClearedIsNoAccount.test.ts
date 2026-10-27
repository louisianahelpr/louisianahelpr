/**
 * Sentry JAVASCRIPT-1Q (14 events / 7 users on /profile by 2026-10-27): after
 * stripe-connect CONFIRMS and CLEARS an unusable Connect account (Q859) it
 * answers 409 { recoverable: true }. Both payout fetchers reported that as an
 * error, and fetchPayoutStatus threw it, so the helper saw "We couldn't check
 * your payout status" instead of the set-up flow.
 *
 * Now a 409 carrying the flag is the edge function's own no-account answer
 * (status) or an empty list (methods), with no report. Not null: the status
 * hook's select reports and throws on null (src/hooks/useStripeConnectStatus.ts).
 * Narrow: a 5xx with the flag, or a 409 without it, is still a failure.
 *
 * No mocked Supabase client (CLAUDE.md): the decision is a pure function over
 * the SDK's error shape (a FunctionsHttpError keeps the Response on .context),
 * and the fetchers are read from source to prove they consult it first.
 *
 * @mutate src/lib/payoutSetupQueries.ts |   if (!(ctx instanceof Response) \|\| ctx.status !== 409) return false; |   if (!(ctx instanceof Response)) return false;
 * @mutate src/lib/payoutSetupQueries.ts |   return (await functionErrorBody(err))?.recoverable === true; |   return true;
 * @mutate src/lib/payoutSetupQueries.ts |     if (await payoutAccountWasCleared(err)) return NO_PAYOUT_ACCOUNT; |     if (await payoutAccountWasCleared(err)) return null;
 * @mutate src/lib/payoutSetupQueries.ts |       if (await payoutAccountWasCleared(res.error)) return []; |       void 0;
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { blankComments } from "./helpers/blankNonCode";
import { NO_PAYOUT_ACCOUNT, payoutAccountWasCleared } from "@/lib/payoutSetupQueries";

/** The SDK's FunctionsHttpError: an Error with the raw Response on .context. */
const fnError = (status: number, body: unknown) =>
  Object.assign(new Error("Edge Function returned a non-2xx status code"), {
    context: new Response(typeof body === "string" ? body : JSON.stringify(body), { status }),
  });

const CLEARED = { error: "Your previous payout account is no longer valid. Tap Connect again to set up a fresh one.", recoverable: true };

describe("a cleared payout account is the no-account answer, not an error", () => {
  it("stripe-connect's 409 { recoverable: true } is a cleared account", async () => {
    expect(await payoutAccountWasCleared(fnError(409, CLEARED))).toBe(true);
  });

  it("and nothing wider: no flag, another status, no body, no Response", async () => {
    expect(await payoutAccountWasCleared(fnError(409, { error: "x" }))).toBe(false);
    expect(await payoutAccountWasCleared(fnError(500, CLEARED))).toBe(false);
    expect(await payoutAccountWasCleared(fnError(400, CLEARED))).toBe(false);
    expect(await payoutAccountWasCleared(fnError(409, "<html>bad gateway</html>"))).toBe(false);
    expect(await payoutAccountWasCleared(new Error("Failed to fetch"))).toBe(false);
    expect(await payoutAccountWasCleared(null)).toBe(false);
  });

  it("the no-account answer is the edge function's own, and passes the status hook's shape check", () => {
    const edge = blankComments(readFileSync("supabase/functions/stripe-connect/index.ts", "utf8"));
    expect(edge).toContain("JSON.stringify({ connected: false, details_submitted: false, payouts_enabled: false })");
    expect(edge).toMatch(/recoverable: true,\s*\}\), \{ headers: \{ \.\.\.corsHeaders, "Content-Type": "application\/json" \}, status: 409 \}/);
    expect(NO_PAYOUT_ACCOUNT).toMatchObject({ connected: false, details_submitted: false, payouts_enabled: false });
    // useStripeConnectStatus's select throws unless payouts_enabled is a boolean.
    expect(typeof NO_PAYOUT_ACCOUNT.payouts_enabled).toBe("boolean");
  });

  it("both fetchers consult it before they report (read from source)", () => {
    const src = blankComments(readFileSync("src/lib/payoutSetupQueries.ts", "utf8"));
    const status = src.slice(src.indexOf("export async function fetchPayoutStatus"), src.indexOf("export async function fetchPayoutMethods"));
    const methods = src.slice(src.indexOf("export async function fetchPayoutMethods"));
    expect(status.length).toBeGreaterThan(100);
    expect(methods.length).toBeGreaterThan(100);
    const before = (body: string, a: string, b: string) => body.indexOf(a) >= 0 && body.indexOf(a) < body.indexOf(b);
    expect(before(status, "if (await payoutAccountWasCleared(err)) return NO_PAYOUT_ACCOUNT;", "report(err")).toBe(true);
    expect(before(methods, "if (await payoutAccountWasCleared(res.error)) return [];", "report(res.error")).toBe(true);
  });
});
