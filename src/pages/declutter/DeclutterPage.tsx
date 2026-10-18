import { DeclutterGate } from "@/components/declutter/declutterUi";
import { DeclutterHomeSkeleton } from "@/components/declutter/DeclutterSkeletons";
import DeclutterHome from "@/components/declutter/DeclutterHomeView";
import { FinishSalesView } from "@/components/declutter/DeclutterTradeViews";
import { useFeatureStatus } from "@/hooks/useFeature";

/**
 * /declutter: the 404 unless the hidden 'declutter' switch is on (DeclutterGate),
 * except that a member with a sale already agreed gets the cart and their sales
 * to finish it (row 62).
 */
export default function DeclutterPage() {
  // Asked HERE, alongside the gate's 'declutter' read, so DeclutterHome's tab
  // row (which waits for this answer, Q?declutter-settle) finds it already in
  // instead of asking only once the gate opens. Same query key, one request.
  useFeatureStatus("declutter_wanted");
  return (
    <DeclutterGate skeleton={<DeclutterHomeSkeleton />} agreedSales={<FinishSalesView />}>
      <DeclutterHome />
    </DeclutterGate>
  );
}
