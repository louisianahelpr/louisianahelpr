import { DeclutterGate } from "@/components/declutter/declutterUi";
import { DeclutterSellSkeleton } from "@/components/declutter/DeclutterSkeletons";
import SellFlow from "@/components/declutter/DeclutterSellView";

/** /declutter/sell: the 404 unless the hidden 'declutter' switch is on (DeclutterGate). */
export default function DeclutterSellPage() {
  return (
    <DeclutterGate skeleton={<DeclutterSellSkeleton />}>
      <SellFlow />
    </DeclutterGate>
  );
}
