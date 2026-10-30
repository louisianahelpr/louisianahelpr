import { lazy, Suspense } from "react";
import { useSearchParams } from "react-router-dom";
import { DeclutterGate } from "@/components/declutter/declutterUi";
import { DeclutterSellSkeleton } from "@/components/declutter/DeclutterSkeletons";
import SellFlow from "@/components/declutter/DeclutterSellView";
import SellChooser from "@/components/declutter/DeclutterSellChooser";
import { SellerSetupGate } from "@/components/declutter/SellerSetup";
import { startsFree, wantsSellChooser } from "@/lib/declutter/sellChooser";

// "Sell a bunch" (owner 2026-10-29) loads only when it is asked for.
const BunchFlow = lazy(() => import("@/components/declutter/DeclutterBunchView"));

/**
 * /declutter/sell: the 404 unless the hidden 'declutter' switch is on (DeclutterGate).
 * ?mode=bunch is "Sell a bunch": many items from many photos at once, same gate.
 * ?mode=choose is "What do you want to sell?" (owner 2026-10-30), where every Sell button goes; any other deep link
 * (?mode=bunch, ?item=, ?answer=, ?free=1, or none) opens its flow straight away.
 */
export default function DeclutterSellPage() {
  const [params] = useSearchParams();
  return (
    <DeclutterGate skeleton={<DeclutterSellSkeleton />}>
      {wantsSellChooser(params) ? (
        <SellChooser />
      ) : params.get("mode") === "bunch" ? (
        <SellerSetupGate>
          <Suspense fallback={<DeclutterSellSkeleton />}>
            <BunchFlow />
          </Suspense>
        </SellerSetupGate>
      ) : params.get("item") ? (
        <SellFlow />
      ) : (
        <SellerSetupGate free={startsFree(params)}>
          <SellFlow />
        </SellerSetupGate>
      )}
    </DeclutterGate>
  );
}
