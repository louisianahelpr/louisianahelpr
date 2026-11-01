/**
 * /declutter's first screen does not carry the order views (lead 11-01, Builder 66's plan): the Buying and Selling
 * bodies, the switched-off sales view and the ?talk= handover chat load on demand, so the order / offer / handover
 * chunk (~24 KB gz, handoverCopy-*.js in the 11-01 build) is no longer in every /declutter visit, which opens on Browse.
 *
 * Inventory from source: the STATIC import graph from DeclutterPage.tsx (comments blanked; `import type` and dynamic
 * `import()` are not edges), resolved file by file. No module of the order set may be in it, and the small pieces the
 * first screen needs (badge counts, section heading, strikes) come from the leaf DeclutterTabHeads, which imports
 * nothing of the order set itself. Measured 11-01 on the built app: see the commit message.
 *
 * @mutate src/components/declutter/DeclutterHomeView.tsx | import { SectionHeading, StrikeCount, useDeclutterTodo } from "./DeclutterTabHeads"; | import { SectionHeading, StrikeCount, useDeclutterTodo } from "./DeclutterTradeViews";
 * @mutate src/components/declutter/DeclutterHomeView.tsx | import { report } from "@/lib/errorLogger"; | import { report } from "@/lib/errorLogger"; import { BuyingDash as _B } from "./DeclutterMineViews";
 * @mutate src/pages/declutter/DeclutterPage.tsx | import { lazy, Suspense, useEffect } from "react"; | import { lazy, Suspense, useEffect } from "react"; import { HandoverTalkFromLink as _T } from "@/components/declutter/DeclutterHandoverTalk";
 * @mutate src/components/declutter/SellerQuestionsToAnswer.tsx | import { SectionHeading } from "./DeclutterTabHeads"; | import { SectionHeading } from "./DeclutterTabParts";
 * @mutate src/components/declutter/DeclutterTabHeads.tsx | import { DeclutterNotice } from "./declutterUi"; | import { DeclutterNotice } from "./declutterUi"; import "./DeclutterOffersSection";
 * @mutate src/components/declutter/DeclutterMineLazy.tsx |     if (mineAsked) return warm(); |     if (mineAsked) return;
 * @mutate src/components/declutter/DeclutterHomeView.tsx |   useWarmMineViews(view === "buying" \|\| view === "selling"); |   useWarmMineViews(false);
 */
import { describe, expect, it } from "vitest";
import { existsSync, readFileSync, statSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { blankComments } from "./helpers/blankNonCode";

const ROOT = resolve(__dirname, "../..");
const SRC = resolve(ROOT, "src");

/** The order / offer / handover views (the 11-01 build's handoverCopy chunk) plus the tab bodies that pull them. */
const ORDER_SET = [
  "components/declutter/DeclutterTradeViews.tsx",
  "components/declutter/DeclutterMineViews.tsx",
  "components/declutter/DeclutterTabParts.tsx",
  "components/declutter/DeclutterHandoverViews.tsx",
  "components/declutter/DeclutterHandoverTalk.tsx",
  "components/declutter/DeclutterOffersSection.tsx",
  "components/declutter/DeclutterFreeClaim.tsx",
  "components/declutter/DeclutterHandoverSheets.tsx",
  "components/declutter/DeclutterPorchHandover.tsx",
  "components/declutter/DeclutterReviewForm.tsx",
  "components/declutter/BuyingOrders.tsx",
];

function resolveSpec(from: string, spec: string): string | null {
  const base = spec.startsWith("@/") ? resolve(SRC, spec.slice(2)) : spec.startsWith(".") ? resolve(dirname(from), spec) : null;
  if (!base) return null;
  for (const ext of ["", ".ts", ".tsx", ".mjs", "/index.ts", "/index.tsx"]) {
    const p = base + ext;
    if (existsSync(p) && statSync(p).isFile()) return p;
  }
  return null;
}

/** Static value imports and re-exports of one file (never `import type`, never `import()`). */
function staticImports(file: string): string[] {
  const code = blankComments(readFileSync(file, "utf8"));
  const out: string[] = [];
  for (const m of code.matchAll(/(?:^|;)\s*(?:import|export)\s+(type\s+)?(?:[^;"']*?\sfrom\s+)?["']([^"']+)["']/gm)) {
    if (m[1]) continue;
    const r = resolveSpec(file, m[2]);
    if (r) out.push(r);
  }
  return out;
}

/** file -> the file that first imported it, from `root`. */
function graph(root: string): Map<string, string | null> {
  const seen = new Map<string, string | null>([[root, null]]);
  const queue = [root];
  while (queue.length) {
    const f = queue.shift()!;
    for (const d of staticImports(f)) if (!seen.has(d)) { seen.set(d, f); queue.push(d); }
  }
  return seen;
}

const rel = (f: string) => f.slice(SRC.length + 1);
const chain = (g: Map<string, string | null>, f: string) => {
  const out: string[] = [];
  for (let k: string | null | undefined = f; k; k = g.get(k)) out.unshift(rel(k));
  return out.join(" -> ");
};

describe("/declutter's first screen loads the order views on demand", () => {
  it("no order, offer or handover view is in DeclutterPage's static import graph", () => {
    const g = graph(resolve(SRC, "pages/declutter/DeclutterPage.tsx"));
    // Inventory floor: the walk really reads the page's graph (the home view, the tab heads, the shared skeletons).
    // Browse is lazy since B77 (src/boot/declutterTabsLoadAlone.test.ts), so it is no longer a static edge.
    expect(g.size).toBeGreaterThan(60);
    expect([...g.keys()].map(rel)).toEqual(expect.arrayContaining([
      "components/declutter/DeclutterHomeView.tsx",
      "components/declutter/DeclutterTabHeads.tsx",
      "components/declutter/DeclutterSkeletons.tsx",
    ]));
    for (const f of ORDER_SET) expect(existsSync(resolve(SRC, f)), f).toBe(true);
    const reached = ORDER_SET.filter((f) => g.has(resolve(SRC, f))).map((f) => chain(g, resolve(SRC, f)));
    expect(reached).toEqual([]);
  });

  it("the leaf the first screen uses imports none of them either", () => {
    const g = graph(resolve(SRC, "components/declutter/DeclutterTabHeads.tsx"));
    expect(ORDER_SET.filter((f) => g.has(resolve(SRC, f)))).toEqual([]);
  });

  it("Buying and Selling still open their real bodies, and their code warms before a tap", () => {
    const lazyMod = blankComments(readFileSync(resolve(SRC, "components/declutter/DeclutterMineLazy.tsx"), "utf8"));
    const home = blankComments(readFileSync(resolve(SRC, "components/declutter/DeclutterHomeView.tsx"), "utf8"));
    // The lazy pair stays; once warmed the loaded module is drawn directly (declutterMineLazy.test.tsx proves no bones).
    expect(lazyMod).toContain('const loadMineViews = () => loadModule(() => import("./DeclutterMineViews")).then((m) => (m ? (loaded = m) : null));');
    expect(lazyMod).toContain("const LazyBuying = lazy(() => loadMineViews().then((m) => (m ? { default: m.BuyingDash } : untilReload())));");
    expect(lazyMod).toContain("const LazySelling = lazy(() => loadMineViews().then((m) => (m ? { default: m.SellingDash } : untilReload())));");
    expect(home).toContain("<Suspense fallback={<DeclutterTabBones />}><SellingDash");
    // Asked for: at once. Any other tab: once the page has settled (never on Browse's critical path).
    expect(lazyMod).toContain("if (mineAsked) return warm();");
    expect(lazyMod).toContain("return whenPageSettled(warm);");
    expect(home).toContain('useWarmMineViews(view === "buying" || view === "selling");');
    const page = blankComments(readFileSync(resolve(SRC, "pages/declutter/DeclutterPage.tsx"), "utf8"));
    expect(page).toContain('{params.get("talk") && <Suspense fallback={null}><HandoverTalkFromLink /></Suspense>}');
    expect(page).toContain("agreedSales={<Suspense fallback={<DeclutterHomeSkeleton />}><FinishSalesView /></Suspense>}");
  });
});
