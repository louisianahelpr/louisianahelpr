import { DeclutterGate } from "@/components/declutter/declutterUi";
import { DeclutterHomeSkeleton } from "@/components/declutter/DeclutterSkeletons";
import DeclutterHome from "@/components/declutter/DeclutterHomeView";
import { FinishSalesView } from "@/components/declutter/DeclutterTradeViews";

/**
 * /declutter: the 404 unless the hidden 'declutter' switch is on (DeclutterGate),
 * except that a member with a sale already agreed gets the cart and their sales
 * to finish it (row 62).
 */
export default function DeclutterPage() {
  return (
    <DeclutterGate skeleton={<DeclutterHomeSkeleton />} agreedSales={<FinishSalesView />}>
      <DeclutterHome />
    </DeclutterGate>
  );
}
