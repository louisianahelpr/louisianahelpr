/**
 * Builder 3, 11-04 (lead lexilombas-42): Money (src/components/profile/EarningsTab.tsx) statically imported the dialog
 * primitives and two small hooks guest /browse shares, and in the browse-first-screen group they put that whole guest
 * chunk (JobCard, the filters, SavedSearches, MapKit's hook: 28.9 KB gz) on Money's critical path. The primitives now
 * have their own "dialog-primitives" chunk and the two hooks stay out of the browse group. Local real-env build, KB gz:
 * /profile?tab=earnings 396 -> 360, /admin 358 -> 300, /browse 304 -> 304, every route's rounds unchanged.
 * The Declutter item page did the same through src/lib/declutter/categoryIcons.ts; it rides in dialog-primitives too
 * (in the skip list it landed on the guest landing's path: / +9 KB gz). With the boot chunking, bundle-size env:
 * item 461 -> 433. Each page below may not reach a browse-only module the browse group would capture.
 *
 * @mutate vite.config.ts | const DIALOG_PRIMITIVES = /[\\/]src[\\/]components[\\/]ui[\\/](dialog\.tsx | const DIALOG_PRIMITIVES = /[\\/]src[\\/]components[\\/]ui[\\/](dialogNever\.tsx
 * @mutate vite.config.ts | hooks[\\/](useMembershipsOn\|useArrivalGate\|usePullToRefresh)\.ts | hooks[\\/](useMembershipsOn\|usePullToRefresh)\.ts
 * @mutate vite.config.ts | test: (id: string) => DIALOG_PRIMITIVES.test(id) \|\| DECLUTTER_CATEGORY_ICONS.test(id), | test: (id: string) => DIALOG_PRIMITIVES.test(id),
 * @mutate vite.config.ts | test: (id: string) => DIALOG_PRIMITIVES.test(id) \|\| DECLUTTER_CATEGORY_ICONS.test(id), | test: (id: string) => DECLUTTER_CATEGORY_ICONS.test(id),
 * @mutate vite.config.ts | hooks[\\/](useMembershipsOn\|useArrivalGate | hooks[\\/](useMembershipsNever\|useArrivalGate
 *
 * Q2705 (11-17): once the guest job preview left guest /browse's static graph, the dialog stack stopped being
 * browse-only, so these pages now share 1 (Money: useMembershipsOn) and 0 (item page) browse-only modules, down from
 * the old "more than 3" floor. The floor is now: the browse-only set and each page's walk are large, Money still
 * shares useMembershipsOn (a real shared module the skip list must catch), the leak filter flags a planted browse-only
 * module, and every module these pages once leaked through stays matched by the skip list or its own chunk.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { guestBrowseSplit, staticReach } from "../../scripts/perf/bootReach.mjs";
import { blankComments } from "./helpers/blankNonCode";

const ROOT = resolve(__dirname, "../..");
const config = blankComments(readFileSync(resolve(ROOT, "vite.config.ts"), "utf8"));
const regexConst = (name: string): RegExp => {
  const m = config.match(new RegExp(`const ${name} = /(.+)/;\\n`));
  expect(m, `${name} in vite.config.ts`).toBeTruthy();
  return new RegExp(m![1]);
};

const PAGES = ["src/components/profile/EarningsTab.tsx", "src/pages/declutter/DeclutterItemPage.tsx"];

describe("Money's and the Declutter item's first screens do not fetch guest /browse's chunk", () => {
  it.each(PAGES)("every browse-only module %s reaches is kept out of the browse-first-screen group", (page) => {
    const skips = regexConst("BROWSE_GROUP_SKIPS");
    const own = [regexConst("DIALOG_PRIMITIVES"), regexConst("DECLUTTER_CATEGORY_ICONS")];
    const group = config.match(/name:\s*"dialog-primitives",[\s\S]*?\}/)?.[0] ?? "";
    expect(group).toMatch(/test:\s*\(id: string\) => DIALOG_PRIMITIVES\.test\(id\) \|\| DECLUTTER_CATEGORY_ICONS\.test\(id\),/);
    expect(group).toMatch(/includeDependenciesRecursively:\s*false/);
    const prio = (g: string) => Number(g.match(/priority:\s*(\d+)/)?.[1] ?? NaN);
    const browse = config.match(/name:\s*"browse-first-screen",[\s\S]*?\}/)?.[0] ?? "";
    expect(prio(group)).toBeGreaterThan(prio(browse));
    const { browseOnly } = guestBrowseSplit(ROOT);
    const reach = staticReach(ROOT, [resolve(ROOT, page).split("\\").join("/")]);
    // Floor: the walk really covers the page.
    expect(reach.size).toBeGreaterThan(80);
    // Floor: the browse-only set is the real guest feed graph (60 modules on 11-17), not an empty walk.
    expect(browseOnly.size).toBeGreaterThan(30);
    const isLeak = (f: string) => !skips.test(f) && !own.some((re) => re.test(f));
    const shared = [...reach].filter((f) => browseOnly.has(f));
    // Seed: a browse-only module no skip covers (JobCard) is flagged, so the filter below cannot pass vacuously.
    const jobCard = resolve(ROOT, "src/components/dashboard/JobCard.tsx").split("\\").join("/");
    expect(browseOnly.has(jobCard)).toBe(true);
    expect([...shared, jobCard].filter(isLeak)).toEqual([jobCard]);
    if (page.endsWith("EarningsTab.tsx")) expect(shared.map((f) => f.slice(ROOT.length + 1))).toContain("src/hooks/useMembershipsOn.ts");
    expect(shared.filter(isLeak)).toEqual([]);
  });

  it("every module these pages once shared with the browse group stays kept out of it", () => {
    const skips = regexConst("BROWSE_GROUP_SKIPS");
    const own = [regexConst("DIALOG_PRIMITIVES"), regexConst("DECLUTTER_CATEGORY_ICONS")];
    const KEPT_OUT = [
      "src/hooks/useMembershipsOn.ts",
      "src/hooks/useArrivalGate.ts",
      "src/hooks/usePullToRefresh.ts",
      "src/components/ui/dialog.tsx",
      "src/lib/declutter/categoryIcons.ts",
    ];
    expect(KEPT_OUT.filter((f) => { const id = `${ROOT}/${f}`; return !skips.test(id) && !own.some((re) => re.test(id)); })).toEqual([]);
  });
});
