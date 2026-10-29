import { lazy, Suspense } from "react";
import { useSearchParams } from "react-router-dom";
import { DeclutterGate } from "@/components/declutter/declutterUi";
import { DeclutterSellSkeleton } from "@/components/declutter/DeclutterSkeletons";
import SellFlow from "@/components/declutter/DeclutterSellView";

// "Sell a bunch" (owner 2026-10-29) loads only when it is asked for.
const BunchFlow = lazy(() => import("@/components/declutter/DeclutterBunchView"));

/**
 * /declutter/sell: the 404 unless the hidden 'declutter' switch is on (DeclutterGate).
 * ?mode=bunch is "Sell a bunch": many items from many photos at once, same gate.
 */
export default function DeclutterSellPage() {
  const [params] = useSearchParams();
  return (
    <DeclutterGate skeleton={<DeclutterSellSkeleton />}>
      {params.get("mode") === "bunch" ? (
        <Suspense fallback={<DeclutterSellSkeleton />}>
          <BunchFlow />
        </Suspense>
      ) : (
        <SellFlow />
      )}
    </DeclutterGate>
  );
}
