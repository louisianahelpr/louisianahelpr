import { describe, expect, it } from "vitest";
// @ts-expect-error - plain .mjs tool script, no types
import { analyzeReport } from "../../scripts/check-audit-evidence.mjs";

type Result = {
  claims: { line: number; text: string; evidence: string[] }[];
  withEvidence: unknown[];
  withoutEvidence: { text: string }[];
  hasUnverifiedSection: boolean;
};

const analyze = analyzeReport as (text: string) => Result;

describe("check-audit-evidence", () => {
  it("flags a bare 'verified working' claim as carrying no artifact", () => {
    const r = analyze("The payout flow was verified and works correctly.\n");
    expect(r.claims).toHaveLength(1);
    expect(r.withoutEvidence).toHaveLength(1);
    expect(r.withEvidence).toHaveLength(0);
  });

  it("accepts a claim backed by an HTTP status", () => {
    const r = analyze("`mapkit-token` works — curl returned status 200.\n");
    expect(r.withEvidence).toHaveLength(1);
    expect(r.withoutEvidence).toHaveLength(0);
  });

  it("accepts a claim backed by a screenshot path", () => {
    const r = analyze("Dashboard renders clean at 375 — /tmp/shots/dash-375.png\n");
    expect(r.withEvidence).toHaveLength(1);
  });

  it("accepts evidence that sits in the lines below the claim", () => {
    const r = analyze(
      ["Browse is clean:", "", "    select count(*) from jobs where status = 'open' → 14 rows"].join(
        "\n",
      ),
    );
    expect(r.withEvidence).toHaveLength(1);
  });

  it("reports a missing UNVERIFIED section", () => {
    expect(analyze("All clear.\n").hasUnverifiedSection).toBe(false);
    expect(
      analyze("## UNVERIFIED — could not reach, and why\n\n- /admin: no owner session\n")
        .hasUnverifiedSection,
    ).toBe(true);
  });

  it("does not treat headings or table rules as claims", () => {
    const r = analyze("## Verified working\n\n| a | b |\n| --- | --- |\n");
    expect(r.claims).toHaveLength(0);
  });

  it("counts defect claims, not just positive ones", () => {
    const r = analyze("Pull-to-refresh is broken after one frame.\n");
    expect(r.claims).toHaveLength(1);
    expect(r.withoutEvidence).toHaveLength(1);
  });
});
