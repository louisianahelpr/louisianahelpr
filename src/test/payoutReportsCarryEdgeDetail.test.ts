// @mutate src/lib/payoutSetupQueries.ts |     report(err, { tags: { source: "PayoutSetupForm.status" }, context: { edge_fn_detail: detail } }); |     report(err, { tags: { source: "PayoutSetupForm.status" } });
// @mutate src/lib/payoutSetupQueries.ts |       report(res.error, { tags: { source: "PayoutSetupForm.methods" }, context: { edge_fn_detail: detail } }); |       report(res.error, { tags: { source: "PayoutSetupForm.methods" } });
/**
 * Sentry JAVASCRIPT-1Q ("FunctionsHttpError: Edge Function returned a non-2xx
 * status code", 13 events, 6 users, last 2026-10-26 14:29Z on an iPhone, source
 * PayoutSetupForm.status) says nothing about WHY stripe-connect refused. Each
 * stripe-connect refusal this file reports carries the function's own reason
 * (functionErrorMessage reads the response body) as context.edge_fn_detail.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { blankComments } from "./helpers/blankNonCode";

describe("payout setup reports carry the edge function's reason", () => {
  const src = blankComments(readFileSync("src/lib/payoutSetupQueries.ts", "utf8"));
  const reports = [...src.matchAll(/report\(([^;]+)\);/g)].map((m) => m[1]);

  it("reads the file's report calls", () => {
    expect(reports.length).toBeGreaterThan(2);
  });

  it("the status refusal carries edge_fn_detail", () => {
    const status = reports.filter((r) => r.includes('"PayoutSetupForm.status"'));
    expect(status.length).toBeGreaterThan(0);
    for (const r of status) expect(r).toContain("edge_fn_detail: detail");
  });

  it("the methods refusal (res.error) carries edge_fn_detail", () => {
    const refusal = reports.filter((r) => r.startsWith("res.error") && r.includes('"PayoutSetupForm.methods"'));
    expect(refusal).toHaveLength(1);
    expect(refusal[0]).toContain("edge_fn_detail: detail");
  });
});
