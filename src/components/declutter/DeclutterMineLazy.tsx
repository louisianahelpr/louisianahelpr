/**
 * The Buying and Selling bodies, loaded on their own (lead 11-01, the /declutter order chunk): their order, offer and
 * handover views were ~24 KB gz in every /declutter first screen, which opens on Browse. DeclutterHomeView draws these
 * inside Suspense (DeclutterTabBones) and calls useWarmMineViews, so the code starts loading as soon as either tab is
 * the one asked for (beside the badge reads the tab row waits on), and once the page has settled on any other tab, so
 * a tap on Buying or Selling finds it loaded. Guard: src/test/declutterTabsLoadOnDemand.test.ts.
 */
import { lazy, useEffect } from "react";
import { whenPageSettled } from "@/lib/routePrefetch";

const loadMineViews = () => import("./DeclutterMineViews");
export const BuyingDash = lazy(() => loadMineViews().then((m) => ({ default: m.BuyingDash })));
export const SellingDash = lazy(() => loadMineViews().then((m) => ({ default: m.SellingDash })));

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
