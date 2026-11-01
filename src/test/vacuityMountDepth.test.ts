/**
 * Class (b) mount-wiring looks MOUNT_DEPTH (3) production levels up.
 *
 * A test that renders a page renders the chain under it, so a component three
 * levels below a rendered page is proven mounted. The scan used to stop at two
 * levels and listed SellItForMe as a gap even though declutterSellPhotos
 * renders DeclutterSellPage -> DeclutterSellView -> SellOneScreen ->
 * SellItForMe (lead 10-31: a general fix, not a baseline entry). It must still
 * stop at three: a test four levels up does not count.
 *
 * @mutate scripts/vacuity/scan.mjs | export const MOUNT_DEPTH = 3; | export const MOUNT_DEPTH = 2;
 * @mutate scripts/vacuity/scan.mjs | for (let d = 1; d <= depth && level.size && !covered; d++) { | for (let d = 1; d <= 99 && level.size && !covered; d++) {
 * @mutate scripts/vacuity/scan.mjs | if (renderedByTests.has(p)) { covered = true; break; } | if (renderedByTests.has(p)) { break; }
 *
 * The app root (lead 10-31): a component App.tsx mounts DIRECTLY is mounted on
 * every app start, so it is no gap (SignedInChrome, AppLockGate, ErrorBoundary,
 * ForceUpdateGate, RouteErrorBoundary). A grandchild still needs a rendered
 * ancestor.
 * @mutate scripts/vacuity/scan.mjs | if ([...parents].some((p) => roots.has(p))) continue; | if (false) continue;
 * @mutate scripts/vacuity/scan.mjs | export const APP_ROOTS = new Set(["src/App.tsx"]); | export const APP_ROOTS = new Set([]);
 * @mutate scripts/vacuity/scan.mjs | if ([...parents].some((p) => roots.has(p))) continue; | if ([...parents].some((p) => roots.has(p)) \|\| true) continue;
 */
import { beforeAll, describe, it, expect } from "vitest";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

// By URL, like vacuityGate.test.ts: scripts/ is outside tsconfig.app.json.
const url = (f: string) => pathToFileURL(join(process.cwd(), "scripts", "vacuity", f)).href;

type Gap = { module: string; parents: string[] };
type Graph = Map<string, Set<string>>;
let findMountGaps: (mountedBy: Graph, renderedByTests: Graph, depth?: number, roots?: Set<string>) => Gap[];
let scanMountWiring: () => Gap[];

beforeAll(async () => {
  ({ findMountGaps, scanMountWiring } = await import(/* @vite-ignore */ url("scan.mjs")));
});

/** chain[0] is the component a test renders; chain[i+1] mounts chain[i]. */
function chain(names: string[], testRenders: string[]): [Graph, Graph] {
  const mountedBy: Graph = new Map();
  for (let i = 0; i + 1 < names.length; i++) mountedBy.set(names[i], new Set([names[i + 1]]));
  const rendered: Graph = new Map(testRenders.map((n) => [n, new Set([`${n}.test.tsx`])]));
  return [mountedBy, rendered];
}

describe("mount-wiring depth", () => {
  const names = ["Leaf", "Parent", "Grand", "Great", "Great2"];

  it.each([
    ["Parent", 1],
    ["Grand", 2],
    ["Great", 3],
  ])("a test rendering the level-%s ancestor proves the mount", (ancestor) => {
    // The ancestor itself may be a gap (nothing renders ITS parents); Leaf is not.
    const gaps = findMountGaps(...chain(names, ["Leaf", ancestor])).map((g) => g.module);
    expect(gaps).not.toContain("Leaf");
  });

  it("a test four levels up does not count", () => {
    const gaps = findMountGaps(...chain(names, ["Leaf", "Great2"]));
    expect(gaps.map((g) => g.module)).toContain("Leaf");
  });

  it("no ancestor rendered is a gap; a mount cycle does not loop", () => {
    const [m, r] = chain(["Leaf", "A", "B"], ["Leaf"]);
    m.set("B", new Set(["A"]));
    expect(findMountGaps(m, r).map((g) => g.module)).toEqual(["Leaf"]);
  });

  it("a component the app root mounts directly is no gap; its grandchild still is", () => {
    const [m, r] = chain(["Leaf", "Mid", "Root"], ["Leaf", "Mid"]);
    const roots = new Set(["Root"]);
    expect(findMountGaps(m, r, 3, roots).map((g) => g.module)).toEqual([]);
    expect(findMountGaps(m, r, 3, new Set()).map((g) => g.module)).toEqual(["Mid"]);
    const [m2, r2] = chain(["Leaf", "Mid", "Root"], ["Leaf"]);
    expect(findMountGaps(m2, r2, 3, roots).map((g) => g.module)).toEqual(["Leaf"]);
  });

  // One real-tree scan (~7 s alone, far longer beside other files) shared by the two cases below.
  let realScan: Gap[] | null = null;
  const real = () => (realScan ??= scanMountWiring());

  it("on the real tree App.tsx's direct children are no gaps", () => {
    const gaps = real().map((g) => g.module);
    for (const mod of ["SignedInChrome", "AppLockGate", "ErrorBoundary", "ForceUpdateGate", "RouteErrorBoundary"])
      expect(gaps).not.toContain(`src/components/${mod}.tsx`);
  }, 120_000);

  it("on the real tree SellItForMe is not a gap, and the scan still finds gaps", () => {
    const gaps = real();
    expect(gaps.length).toBeGreaterThan(5);
    expect(gaps.map((g) => g.module)).not.toContain("src/components/declutter/SellItForMe.tsx");
  }, 120_000);
});
