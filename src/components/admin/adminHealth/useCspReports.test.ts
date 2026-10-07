/**
 * Q1352: CSP reports are counted by directive and blocked host, report_count
 * included (one error_logs row can carry a batch), most first; none is an ok
 * row, never an empty card.
 *
 * @mutate src/components/admin/adminHealth/useCspReports.ts |     const n = Number((r.context ?? {}).report_count ?? 1) \|\| 1; |     const n = 1;
 */
import { describe, it, expect } from "vitest";
import { cspChecks } from "./useCspReports";

describe("cspChecks (Q1352)", () => {
  it("counts reports per directive + blocked host, a batch row by its report_count", () => {
    const out = cspChecks(
      [
        { tags: { directive: "script-src-elem", blocked: "https://cdn.bad.example/a.js?x=1" }, context: { report_count: 3 } },
        { tags: { directive: "script-src-elem", blocked: "https://cdn.bad.example/b.js" }, context: null },
        { tags: { directive: "img-src", blocked: "inline" }, context: { report_count: 1 } },
      ],
      false,
    );
    expect(out[0].label).toBe("5 CSP violation reports in the last 24 hours");
    expect(out.slice(1).map((c) => c.label)).toEqual([
      "script-src-elem blocked cdn.bad.example (4×)",
      "img-src blocked inline (1×)",
    ]);
  });

  it("none is an ok row, not an empty card", () => {
    const out = cspChecks([], false);
    expect(out).toHaveLength(1);
    expect(out[0].tone).toBe("ok");
  });
});
