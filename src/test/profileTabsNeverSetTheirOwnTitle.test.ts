/**
 * VC-011: a Profile tab's browser title is Profile.tsx's
 * `${TAB_TITLES[tab]} — My Profile — Helpr`. A tab component that also calls
 * usePageTitle overwrites it (child effects run first, but the child re-runs
 * last on its own deps), which is how eight tabs read "X — Helpr" or bare
 * "Analytics". Inventory: every module ProfileTabPanels lazy-imports.
 *
 * @mutate src/pages/HelperAnalytics.tsx | // Advanced Analytics, the Pro/Elite perk | // usePageTitle("Analytics"); Advanced Analytics, the Pro/Elite perk
 */
import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const panels = readFileSync("src/pages/profile/ProfileTabPanels.tsx", "utf8");
const tabs = [...panels.matchAll(/lazy\(\(\) => import\("@\/(.+?)"\)\)/g)]
  .map((m) => ["tsx", "ts"].map((x) => `src/${m[1]}.${x}`).find(existsSync) ?? `src/${m[1]}/index.tsx`)
  .filter(existsSync);

describe("Profile tabs never set their own page title (VC-011)", () => {
  it("the inventory is real", () => {
    expect(tabs.length).toBeGreaterThanOrEqual(10);
  });
  it("no tab component calls usePageTitle", () => {
    expect(tabs.filter((f) => /\busePageTitle\b/.test(readFileSync(f, "utf8")))).toEqual([]);
  });
});
