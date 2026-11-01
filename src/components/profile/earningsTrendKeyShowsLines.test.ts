/**
 * B82 (2026-11-01, lab shot with 10 earned jobs, ~/.lh-shots/b82-1101/shots/money-*): the "this year vs last year" chart
 * draws last year dashed and this year solid, but Recharts' default key icon drew both years the same, so the key did
 * not say which line is which. legendType="plainline" draws each line's own stroke (dash included) in the key.
 *
 * @mutate src/components/profile/EarningsBreakdownCharts.tsx | stroke={olive}\n                  legendType="plainline" | stroke={olive}\n                  legendType="line"
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { blankComments } from "@/test/helpers/blankNonCode";

const src = blankComments(readFileSync("src/components/profile/EarningsBreakdownCharts.tsx", "utf8"));
const lines = [...src.matchAll(/<Line\b([\s\S]*?)\/>/g)].map((m) => m[1]);

describe("the earnings trend key tells the two years apart", () => {
  it("every line in the chart keys with its own stroke", () => {
    expect(lines.length).toBeGreaterThanOrEqual(2);
    for (const l of lines) expect(l).toMatch(/legendType="plainline"/);
  });
  it("last year is the dashed one", () => {
    const prior = lines.find((l) => /dataKey="prior"/.test(l)) ?? "";
    expect(prior).toMatch(/strokeDasharray="4 4"/);
  });
});
