/**
 * Home's lazy section reads load alone, not with another screen's chunk (B87, 11-01).
 *
 * Home's Declutter tile and Coming up read through `import("@/lib/declutter/api")`, and useActivityData's schedule
 * reads through `import("@/lib/scheduleChange")` / `import("@/lib/scheduleClashes")`. Those modules sat in
 * signed-in-pages / signed-in-deep (bootReach), so each import made the browser fetch that whole chunk and the ~150 KB
 * gz its preload list names (Radix, dates, browse-first-screen, ...) while the dock was still loading. Now Home's two
 * Declutter reads are src/lib/declutter/myReads.ts (api.ts re-exports them), scheduleChange / scheduleClashes take
 * isNotDeployedYet from src/lib/notDeployedYet.ts instead of seriesDates.ts, and vite.config.ts gives them their own
 * small chunks. Lab (/home, HTTP/2, Slow 4G, x4 CPU, 375, mocked member, median of 5): dock drawn 3.177 -> 2.838 s.
 *
 * @mutate src/pages/home/homeDashboard/useHomeSummary.ts | const declutterApi = () => loadModule(() => import("@/lib/declutter/myReads")); | const declutterApi = () => loadModule(() => import("@/lib/declutter/api"));
 * @mutate src/lib/scheduleChange.ts | import { isNotDeployedYet } from "@/lib/notDeployedYet"; | import { isNotDeployedYet } from "@/lib/seriesDates";
 * @mutate src/lib/scheduleClashes.ts | import { isMissingRpcNamed } from "@/lib/missingRpc"; | import { isMissingRpcNamed } from "@/lib/missingRpc";\nimport { isNotDeployedYet } from "@/lib/seriesDates";\nvoid isNotDeployedYet;
 * @mutate src/lib/declutter/myReads.ts | import { unwrap } from "@/lib/supabaseResult"; | import { unwrap } from "@/lib/supabaseResult";\nimport { rpcErrorMessage as copyNow } from "@/lib/lifecycleErrors";\nvoid copyNow;
 * @mutate vite.config.ts | (scheduleChange\|scheduleClashes\|notDeployedYet)\.ts$/; | (scheduleChange\|notDeployedYet)\.ts$/;
 * @mutate vite.config.ts |               test: HOME_DECLUTTER_READS, |               test: /never-matches-anything/,
 * @mutate vite.config.ts |               test: HOME_SHOP_READS, |               test: /never-matches-anything/,
 * @mutate src/lib/shops/orders.ts | import { rpcErrorMessage } from "./rpcErrorCopy"; | import { rpcErrorMessage } from "./rpcErrorCopy";\nimport { rpcErrorMessage as copyNow } from "@/lib/lifecycleErrors";\nvoid copyNow;
 *
 * Q2706 (B98, 11-04): Home's shop-order reads (src/lib/shops/orders.ts) sat in signed-in-deep, so /home fetched that
 * chunk and its closure (~180 KB gz) when the feature switches answered (lab, prod data, Slow 4G: 4.7 s, before the
 * money tile drew at 7.1 s). Now they ride alone in home-shop-reads.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { blankComments } from "./helpers/blankNonCode";
import { signedInSplit, staticReach } from "../../scripts/perf/bootReach.mjs";

const root = process.cwd();
const read = (f: string) => blankComments(readFileSync(resolve(root, f), "utf8"));
const config = read("vite.config.ts");

/** Each group: its name, its regex constant, the files it must hold. */
const GROUPS: { name: string; re: string; files: string[]; allow?: string[] }[] = [
  { name: "home-declutter-reads", re: "HOME_DECLUTTER_READS", files: ["src/lib/declutter/myReads.ts", "src/lib/declutter/minePrefetchTake.ts"] },
  { name: "home-schedule-reads", re: "HOME_SCHEDULE_READS", files: ["src/lib/scheduleChange.ts", "src/lib/scheduleClashes.ts", "src/lib/notDeployedYet.ts"] },
  // Its one shared module, declutter/errors.ts (ListingPhotoError), rides item-shared: a leaf chunk (~10 KB gz) that
  // imports only app-shared and supabase, never signed-in-deep's closure (checked on the built chunk, B98).
  { name: "home-shop-reads", re: "HOME_SHOP_READS", files: ["src/lib/shops/orders.ts", "src/lib/shops/rpcErrorCopy.ts", "src/lib/shops/errors.ts"], allow: ["src/lib/declutter/errors.ts"] },
];

function groupRegex(constName: string): RegExp {
  const m = config.match(new RegExp(`const ${constName} = /(.+)/;`));
  expect(m, constName).toBeTruthy();
  return new RegExp(m![1]);
}

describe("Home's lazy section reads", () => {
  it("Home imports its Declutter reads from myReads, never from api.ts", () => {
    const src = read("src/pages/home/homeDashboard/useHomeSummary.ts");
    expect(src).toContain('import("@/lib/declutter/myReads")');
    expect(src).not.toMatch(/import\("@\/lib\/declutter\/api"\)/);
    expect(src).not.toMatch(/from "@\/lib\/declutter\/api"/);
  });

  it("each read module has its own chunk group, above signed-in-pages and signed-in-deep", () => {
    for (const g of GROUPS) {
      const re = groupRegex(g.re);
      for (const f of g.files) expect(re.test(resolve(root, f)), `${g.name} holds ${f}`).toBe(true);
      const at = config.indexOf(`name: "${g.name}"`);
      expect(at, g.name).toBeGreaterThan(0);
      const body = config.slice(at, config.indexOf("}", at));
      expect(body).toContain(`test: ${g.re},`);
      expect(Number(body.match(/priority: ([\d.]+)/)?.[1])).toBeGreaterThan(16.5);
    }
  });

  it("their static reach holds no module of another signed-in chunk", () => {
    const { deep, homeOff, homeLate, declutterOnly } = signedInSplit(root);
    const other = new Set([...deep, ...homeOff, ...homeLate, ...declutterOnly]);
    expect(other.size).toBeGreaterThan(50);
    const own = new Set(GROUPS.flatMap((g) => g.files.map((f) => resolve(root, f).replace(/\\/g, "/"))));
    for (const g of GROUPS) {
      const reach = staticReach(root, g.files.map((f) => resolve(root, f)));
      expect(reach.size, g.name).toBeGreaterThan(2);
      const leaks = [...reach].filter((f) => !own.has(f) && other.has(f)).map((f) => f.replace(`${root}/`, "")).filter((f) => !g.allow?.includes(f));
      expect(leaks, g.name).toEqual([]);
    }
  });
});
