/**
 * Admin's Dashboard and Money (Profile > Earnings) do not wait on a chart or
 * animation library they do not show at once (B72, 2026-11-01; cwv-lab admin,
 * 375 Slow 4G + 4x CPU, median of 3):
 *   - KpiSparkline drew four 28 px trend lines with recharts, the 68 KB gz
 *     CartesianChart chunk, the largest file /admin's Dashboard fetched. It
 *     is one inline SVG now, with the same monotone curve.
 *   - Money imported More insights' recharts charts (closed until tapped) and
 *     the framer-motion payout card statically, so its payout reads started
 *     only after both downloaded: wallet card 7622 -> 7202 ms with the charts
 *     lazy, and the card behind payoutCelebrationGate.ts after that.
 *
 * @mutate src/components/admin/KpiSparkline.tsx | import { useId } from "react"; | import { useId } from "react";\nimport "recharts";
 * @mutate src/components/profile/EarningsTab.tsx | import { hasPayoutToCelebrate } from "@/components/wallet/payoutCelebrationGate"; | import { hasPayoutToCelebrate } from "@/components/wallet/payoutCelebrationGate";\nimport { EarningsBreakdownCharts as _C } from "@/components/profile/EarningsBreakdownCharts";
 * @mutate src/components/profile/EarningsTab.tsx | import { hasPayoutToCelebrate } from "@/components/wallet/payoutCelebrationGate"; | import { hasPayoutToCelebrate } from "@/components/wallet/payoutCelebrationGate";\nimport { PayoutCelebration as _P } from "@/components/wallet/PayoutCelebration";
 * @mutate src/components/profile/EarningsTab.tsx |           {celebrate && ( |           {true && (
 * @mutate src/components/admin/KpiSparkline.tsx |     t[i] = (sign(s0) + sign(s1)) * Math.min(Math.abs(s0), Math.abs(s1), 0.5 * Math.abs(p)) \|\| 0; |     t[i] = p;
 * @mutate src/components/wallet/payoutCelebrationGate.ts |   return fresh.reduce((sum, p) => sum + (p.amount_cents ?? 0), 0) > 0; |   return true;
 */
import { describe, it, expect, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { blankComments } from "./helpers/blankNonCode";
import { monotoneTangents, sparkPaths } from "@/components/admin/KpiSparkline";
import { hasPayoutToCelebrate, LAST_SEEN_PAYOUT_KEY } from "@/components/wallet/payoutCelebrationGate";
import { safeStorage } from "@/lib/safeStorage";

const ROOT = resolve(__dirname, "../..");
const code = (p: string) => blankComments(readFileSync(resolve(ROOT, p), "utf8"));
/** Static (not `import(...)`) import specifiers of a source file. */
const staticImports = (p: string) =>
  [...code(p).matchAll(/^\s*import\s+(?!type\b)(?:[^'";]*?from\s*)?["']([^"']+)["']/gm)].map((m) => m[1]);

describe("Admin and Money skip chart and animation code they do not show at once", () => {
  it("KpiSparkline imports no chart library", () => {
    const imports = staticImports("src/components/admin/KpiSparkline.tsx");
    expect(imports.length).toBeGreaterThan(0);
    expect(imports.filter((s) => /recharts|framer-motion|chart/i.test(s))).toEqual([]);
  });

  it("Money loads More insights' charts and the payout card lazily", () => {
    const imports = staticImports("src/components/profile/EarningsTab.tsx");
    expect(imports.length).toBeGreaterThan(20);
    expect(imports).not.toContain("@/components/profile/EarningsBreakdownCharts");
    expect(imports).not.toContain("@/components/wallet/PayoutCelebration");
    expect(imports.filter((s) => /recharts|framer-motion/.test(s))).toEqual([]);
    const src = code("src/components/profile/EarningsTab.tsx");
    expect(src).toMatch(/lazy\(\(\) => import\("@\/components\/profile\/EarningsBreakdownCharts"\)/);
    expect(src).toMatch(/lazy\(\(\) => import\("@\/components\/wallet\/PayoutCelebration"\)/);
    // The card is mounted only behind the gate.
    expect(src).toMatch(/\{celebrate && \(\s*<Suspense fallback=\{null\}>\s*<PayoutCelebration /);
  });

  it("the sparkline's curve is monotone: it never overshoots a point", () => {
    const xs = [0, 1, 2, 3, 4];
    const ys = [0, 10, 10, 0, 5];
    const t = monotoneTangents(xs, ys);
    // A flat stretch and a peak get zero tangents (no overshoot past the data).
    expect(t[1]).toBe(0);
    expect(t[2]).toBe(0);
    const { line, area } = sparkPaths([1, 3, 3, 0, 2, 5, 5, 4, 1, 0]);
    expect(line.startsWith("M0,")).toBe(true);
    expect((line.match(/C/g) ?? []).length).toBe(9);
    expect(area.endsWith("Z")).toBe(true);
    // Every control point stays inside the 0..28 box (no overshoot above the peak or below 0).
    const nums = line.replace(/[MC]/g, " ").trim().split(/[ ,]+/).map(Number);
    for (let i = 1; i < nums.length; i += 2) {
      expect(nums[i]).toBeGreaterThanOrEqual(1);
      expect(nums[i]).toBeLessThanOrEqual(28);
    }
  });

  describe("payoutCelebrationGate", () => {
    beforeEach(() => safeStorage.removeItem(LAST_SEEN_PAYOUT_KEY));
    const paid = (id: string, at: string, cents = 500) => ({ id, amount_cents: cents, status: "paid", paid_at: at, created_at: at });

    it("opens for a new paid payout and not for a seen, pending or zero one", () => {
      expect(hasPayoutToCelebrate([])).toBe(false);
      expect(hasPayoutToCelebrate([paid("a", "2026-10-01T00:00:00Z")])).toBe(true);
      expect(hasPayoutToCelebrate([{ ...paid("a", "2026-10-01T00:00:00Z"), status: "pending" }])).toBe(false);
      expect(hasPayoutToCelebrate([paid("a", "2026-10-01T00:00:00Z", 0)])).toBe(false);
      safeStorage.setItem(LAST_SEEN_PAYOUT_KEY, String(Date.parse("2026-10-02T00:00:00Z")));
      expect(hasPayoutToCelebrate([paid("a", "2026-10-01T00:00:00Z")])).toBe(false);
      expect(hasPayoutToCelebrate([paid("b", "2026-10-03T00:00:00Z")])).toBe(true);
    });
  });
});
