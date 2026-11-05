// @mutate src/lib/payoutSetupQueries.ts |   return isNetworkFailure(err) ? "warning" : "error"; |   return "error";
// @mutate src/lib/payoutSetupQueries.ts |   return isNetworkFailure(err) ? "warning" : "error"; |   return "warning";
// @mutate src/lib/payoutSetupQueries.ts |     report(err, { severity: payoutFailureSeverity(err), tags: { source: "PayoutSetupForm.methods" } }); |     report(err, { tags: { source: "PayoutSetupForm.methods" } });
/**
 * Q1615 / item 1b (lead 2026-11-05): a payout status or methods read that never
 * reached stripe-connect (supabase-js FunctionsFetchError, a dropped connection
 * on a slow phone) was logged as an ERROR. The live lab showed it on /jobs and
 * /profile?tab=earnings whenever the request was cut off, and prod had 8 such
 * error rows from real members in 30 days (PayoutSetupForm.status 6,
 * PayoutSetupForm.methods 2). The function never answered, so it is a warning,
 * the same way queryClient.ts files network drops. A refusal the function sent
 * stays an error.
 *
 * No mocked Supabase client (CLAUDE.md): the severity is a pure function over
 * the SDK's error shape, and the fetchers are read from source to prove every
 * report call uses it.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { blankComments } from "./helpers/blankNonCode";
import { payoutFailureSeverity } from "@/lib/payoutSetupQueries";

/** supabase-js's FunctionsFetchError: the fetch itself rejected. */
const fetchError = () =>
  Object.assign(new Error("Failed to send a request to the Edge Function"), { name: "FunctionsFetchError" });
/** supabase-js's FunctionsHttpError: the function answered non-2xx. */
const httpError = () =>
  Object.assign(new Error("Edge Function returned a non-2xx status code"), {
    name: "FunctionsHttpError",
    context: new Response(JSON.stringify({ error: "Stripe is down" }), { status: 502 }),
  });

describe("a payout read that never reached the server is a warning", () => {
  it("a dropped connection is a warning", () => {
    expect(payoutFailureSeverity(fetchError())).toBe("warning");
    expect(payoutFailureSeverity(new TypeError("Load failed"))).toBe("warning");
  });

  it("a refusal the function sent stays an error", () => {
    expect(payoutFailureSeverity(httpError())).toBe("error");
    expect(payoutFailureSeverity(new Error("boom"))).toBe("error");
    expect(payoutFailureSeverity(null)).toBe("error");
  });

  it("every status/methods report in the fetchers uses it", () => {
    const src = blankComments(readFileSync("src/lib/payoutSetupQueries.ts", "utf8"));
    const reports = [...src.matchAll(/report\(([^;]+)\);/g)]
      .map((m) => m[1])
      .filter((r) => /"PayoutSetupForm\.(status|methods)"/.test(r));
    expect(reports.length).toBeGreaterThan(2);
    for (const r of reports) expect(r).toMatch(/severity: payoutFailureSeverity\((err|res\.error)\)/);
  });
});
