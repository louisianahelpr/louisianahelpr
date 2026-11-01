/**
 * The Buying and Selling bodies, loaded on their own (lead 11-01, the /declutter order chunk): their order, offer and
 * handover views were ~24 KB gz in every /declutter first screen, which opens on Browse. DeclutterHomeView draws these
 * inside Suspense (DeclutterTabBones) and calls useWarmMineViews, so the code starts loading as soon as either tab is
 * the one asked for (beside the badge reads the tab row waits on), and once the page has settled on any other tab, so
 * a tap on Buying or Selling finds it loaded. Guard: src/test/declutterTabsLoadOnDemand.test.ts.
 */
import { lazy, useEffect, useState, type ComponentProps } from "react";
import { whenPageSettled } from "@/lib/routePrefetch";
import { loadModule, untilReload } from "@/lib/loadModule";

type MineViews = typeof import("./DeclutterMineViews");
/**
 * The module once the warm-up (or a first open) has it. React.lazy suspends on its first render even when the chunk is
 * already in hand (it settles on a microtask), so a tap on Buying after the page settled committed DeclutterTabBones
 * for one frame (Builder 74, 11-01: the bones on for 6 ms on the first Buying tap, mocked 375 run). With the module
 * here, a tab draws it directly; each mount picks its component ONCE, so a lazy-drawn tab never remounts.
 */
let loaded: MineViews | null = null;
// Through loadModule (src/test/dynamicImportThenDoesNoWork.test.ts): a prevented preload resolves null, and the lazy
// tab then waits on the recovery reload instead of reading `undefined.BuyingDash` (train 13, 11-01).
const loadMineViews = () => loadModule(() => import("./DeclutterMineViews")).then((m) => (m ? (loaded = m) : null));
const LazyBuying = lazy(() => loadMineViews().then((m) => (m ? { default: m.BuyingDash } : untilReload())));
const LazySelling = lazy(() => loadMineViews().then((m) => (m ? { default: m.SellingDash } : untilReload())));

export function BuyingDash(props: ComponentProps<MineViews["BuyingDash"]>) {
  const [Impl] = useState(() => loaded?.BuyingDash ?? LazyBuying);
  return <Impl {...props} />;
}
export function SellingDash(props: ComponentProps<MineViews["SellingDash"]>) {
  const [Impl] = useState(() => loaded?.SellingDash ?? LazySelling);
  return <Impl {...props} />;
}

/** Load the Buying / Selling code now when one of them is the tab asked for, else once the page has settled. */
export function useWarmMineViews(mineAsked: boolean): void {
  useEffect(() => {
    const warm = () => void loadMineViews().catch(() => {
      // A failed warm-up is not an error: the tab's own lazy load tries again, and reports, when it is opened.
    });
    if (mineAsked) return warm();
    return whenPageSettled(warm);
  }, [mineAsked]);
}
