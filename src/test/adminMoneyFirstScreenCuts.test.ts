/**
 * AUD31-61 (B63, 2026-11-01): Admin (3.7 s) and Money (4.6 s) first screens on Fast 4G + 4x CPU. Measured on the
 * built bundle (chunk closures from dist/, bundle-size.yml's env):
 *   /admin (AdminRoute + Admin)  495.9 -> 385.8 KB gz
 *   Money's Earnings tab         598.6 -> 488.6 KB gz
 * Two cuts, each pinned here so a later edit cannot quietly put the bytes back:
 *  1. The breakdown charts (recharts) load only when the closed "breakdown" disclosure opens: EarningsTab never
 *     imports EarningsBreakdownCharts statically.
 *  2. Four leaves the /admin first screen imports have their own small chunks (vite.config.ts small-leaves and
 *     feed-phase). Inside signed-in-deep / signed-in-pages they made /admin fetch those whole chunks and, through
 *     them, declutter-first-screen, rentals and parish-names.
 *
 * @mutate src/components/profile/EarningsTab.tsx | import { HelprSpinner } from "@/components/ui/HelprSpinner"; | import { HelprSpinner } from "@/components/ui/HelprSpinner";\nimport { EarningsBreakdownCharts as _Eager } from "@/components/profile/EarningsBreakdownCharts";
 * @mutate vite.config.ts |               name: "small-leaves", |               name: "small-leaves-off",
 * @mutate vite.config.ts | hooks[\\/](use-mobile\.tsx\|useInstantQuery\.ts))$/, | hooks[\\/](use-mobile\.tsx))$/,
 * @mutate vite.config.ts |               name: "feed-phase", |               name: "feed-phase-off",
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { blankComments } from "./helpers/blankNonCode";

const ROOT = resolve(__dirname, "../..");
const read = (f: string) => blankComments(readFileSync(resolve(ROOT, f), "utf8"));

/** The `test` regex of the vite.config.ts codeSplitting group with this exact name. */
function groupTest(config: string, name: string): RegExp | null {
  const at = config.indexOf(`name: "${name}",`);
  if (at < 0) return null;
  const m = /test:\s*\/((?:\\\/|[^/\n])+)\/([a-z]*),/.exec(config.slice(at, at + 400));
  return m ? new RegExp(m[1], m[2]) : null;
}

describe("Admin and Money first screens stay cut (AUD31-61)", () => {
  it("EarningsTab loads the breakdown charts lazily, never statically", () => {
    const src = read("src/components/profile/EarningsTab.tsx");
    expect(src).not.toMatch(/^\s*import\s[^;]*from\s+"@\/components\/profile\/EarningsBreakdownCharts"/m);
    expect(src).toMatch(/lazy\(\s*\(\)\s*=>\s*import\("@\/components\/profile\/EarningsBreakdownCharts"\)/);
    expect(read("src/components/profile/EarningsBreakdownCharts.tsx")).toMatch(/from "recharts"/);
  });

  it("the /admin first-screen leaves each match their own small chunk group", () => {
    const config = read("vite.config.ts");
    const leaves = groupTest(config, "small-leaves");
    const feed = groupTest(config, "feed-phase");
    const want = ["/r/src/lib/capturedPayment.ts", "/r/src/hooks/use-mobile.tsx", "/r/src/hooks/useInstantQuery.ts"];
    expect(want.length).toBeGreaterThan(2);
    expect(want.filter((p) => !leaves?.test(p))).toEqual([]);
    expect(feed?.test("/r/src/hooks/useFeedPhase.ts")).toBe(true);
    // feed-phase is its own chunk: Profile's first screen imports it and must not reach the signed-in-deep leaves.
    expect(leaves?.test("/r/src/hooks/useFeedPhase.ts")).toBe(false);
  });
});
