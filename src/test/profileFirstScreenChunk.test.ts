/**
 * B90 (2026-11-01): Profile's first screen (Money, Notifications) no longer fetches signed-in-pages and, through that
 * chunk's other modules, the 26.5 KB declutter-item-pages chunk. The signed-in-pages modules Profile reaches have their
 * own group (profile-first-screen); the few helpers the other big signed-in pages also run have a tiny one (leaves).
 * Built graph (critical-path, same session): /profile 433 -> 380 KB gz, Money 433 -> 377. Lab (HTTP/2, Slow 4G, 4x CPU,
 * 375, median of 5): Money ready 4.17 -> 3.87 s.
 *
 * @mutate vite.config.ts |               priority: 15.8, // above declutter-item-pages (15.7) and signed-in-pages (15.5) |               priority: 15.4, // above declutter-item-pages (15.7) and signed-in-pages (15.5)
 * @mutate vite.config.ts | test: (id: string) => profileFirstScreen.has(id.split("?")[0].replace(/\\/g, "/")), | test: (id: string) => id === "",
 * @mutate scripts/perf/bootReach.mjs |     own: new Set(mine.filter((f) => !others.has(f))), |     own: new Set(mine),
 * @mutate scripts/perf/bootReach.mjs |   "src/components/PaymentTab.tsx",\n  "src/components/NotificationPreferences.tsx", |   "src/components/NotificationPreferences.tsx",
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { PROFILE_FIRST_SCREEN_ROOTS, PROFILE_SHARING_PAGE_ROOTS, profileFirstScreenModules, signedInSplit, staticReach } from "../../scripts/perf/bootReach.mjs";
import { blankComments } from "./helpers/blankNonCode";

const ROOT = resolve(__dirname, "../..");
const rel = (abs: string) => abs.slice(ROOT.length + 1).split("\\").join("/");
const config = blankComments(readFileSync(resolve(ROOT, "vite.config.ts"), "utf8"));
const groupOf = (name: string) => config.match(new RegExp(`name:\\s*"${name}",[\\s\\S]*?\\}`))?.[0] ?? "";
const priorityOf = (name: string) => Number(groupOf(name).match(/priority:\s*([\d.]+)/)?.[1]);

describe("Profile's first screen has its own chunk (B90)", () => {
  const split = signedInSplit(ROOT);
  const { own, shared } = profileFirstScreenModules(ROOT, split);

  it("every signed-in-pages module Profile's first screen reaches is in one of the two groups", () => {
    const reach = staticReach(ROOT, PROFILE_FIRST_SCREEN_ROOTS.map((r) => resolve(ROOT, r)));
    const mine = [...split.homeOff].filter((f) => reach.has(f)).map(rel).sort();
    // Floor: the walk really reaches Profile's helpers (useStripeConnectStatus, avatarStorage, ... when written).
    expect(mine.length).toBeGreaterThan(5);
    expect([...own, ...shared].map(rel).sort()).toEqual(mine);
    // Money's bank card is a root: its helpers are in the groups too.
    expect(PROFILE_FIRST_SCREEN_ROOTS).toContain("src/components/PaymentTab.tsx");
    expect(mine).toContain("src/lib/openExternalUrl.ts");
  });

  it("the other big pages never reach the profile-only group (they would fetch Profile's code)", () => {
    const others = staticReach(ROOT, PROFILE_SHARING_PAGE_ROOTS.map((r) => resolve(ROOT, r)));
    expect(own.size).toBeGreaterThan(3);
    expect([...own].filter((f) => others.has(f)).map(rel)).toEqual([]);
  });

  it("vite.config wires both groups above declutter-item-pages and signed-in-pages", () => {
    expect(groupOf("profile-first-screen")).toMatch(/profileFirstScreen\.has\(/);
    expect(groupOf("leaves")).toMatch(/profileSharedLeaves\.has\(/);
    for (const g of ["profile-first-screen", "leaves"]) {
      expect(priorityOf(g), g).toBeGreaterThan(priorityOf("declutter-item-pages"));
      expect(priorityOf(g), g).toBeGreaterThan(priorityOf("signed-in-pages"));
    }
  });
});
