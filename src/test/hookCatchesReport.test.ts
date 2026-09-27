/**
 * Q822: the payout-check and job-lifecycle hooks must REPORT every failure they
 * catch, not only toast it. The repo-wide no-silent-catch lint accepts a toast
 * or a comment as a trace; these hooks sit on money and job-state paths, so
 * here the bar is stricter: every catch calls `report(` (from @/lib/errorLogger).
 * Catch counts are exact, so a new catch is a conscious edit to this file.
 *
 * @mutate src/hooks/useStripeConnectCheck.ts |       report(err, { severity: "warning", tags: { area: "payout", op: "checkHelperStripeConnect" } });\n |
 * @mutate src/hooks/useStripeConnectCheck.ts |       report(err, { severity: "warning", tags: { area: "payout", op: "checkHelperAwardEligibility" } });\n |
 * @mutate src/components/job-card/activityActions/useLifecycleHandlers.ts |       report(err, { tags: { area: "activity", op: "completeJob" }, context: { jobId } });\n |
 * @mutate src/components/job-card/activityActions/useLifecycleHandlers.ts | report(err, { tags: { area: "activity", op: "reportNoShow" } }); |
 * @mutate src/components/job-card/activityActions/useLifecycleHandlers.ts | if (!(err instanceof WriteRejectedError \|\| err instanceof MissingRowCountError)) report(err, { tags: { area: "activity", op: "confirmWorking" }, context: { jobId } }); | void err;
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import ts from "typescript";

const ROOT = resolve(__dirname, "../..");
const FILES: Record<string, number> = {
  "src/hooks/useStripeConnectCheck.ts": 2,
  "src/components/job-card/activityActions/useLifecycleHandlers.ts": 6,
};

function catchBodies(rel: string): string[] {
  const src = readFileSync(resolve(ROOT, rel), "utf8");
  const sf = ts.createSourceFile(rel, src, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const out: string[] = [];
  const visit = (n: ts.Node) => {
    if (ts.isCatchClause(n)) out.push(n.block.getText(sf));
    ts.forEachChild(n, visit);
  };
  visit(sf);
  return out;
}

describe("payout and lifecycle hooks report every caught failure", () => {
  for (const [rel, count] of Object.entries(FILES)) {
    it(`${rel}: exactly ${count} catches, each calls report()`, () => {
      const bodies = catchBodies(rel);
      expect(bodies.length).toBeGreaterThan(0);
      expect(bodies).toHaveLength(count);
      for (const b of bodies) expect(b, b.slice(0, 120)).toMatch(/\breport\(/);
    });
  }
});
