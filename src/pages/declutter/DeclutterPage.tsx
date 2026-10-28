import { DeclutterGate } from "@/components/declutter/declutterUi";
import { DeclutterHomeSkeleton } from "@/components/declutter/DeclutterSkeletons";
import DeclutterHome from "@/components/declutter/DeclutterHomeView";
import { FinishSalesView } from "@/components/declutter/DeclutterTradeViews";
import { HandoverTalkFromLink } from "@/components/declutter/DeclutterHandoverTalk";
import { useEffect } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useFeatureStatus } from "@/hooks/useFeature";
import { afterCardPath, takeAfterCard, type AfterCardState } from "@/lib/declutter/afterCard";

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
  // Back from Stripe's card page (declutter-card returns to
  // /declutter?card=saved or ?card=cancelled): a member who left an item to buy
  // or offer goes back to it; with a saved card it carries on with that action
  // (src/lib/declutter/afterCard.ts), cancelled just lands on the item again.
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const cardReturn = params.get("card");
  useEffect(() => {
    if (cardReturn !== "saved" && cardReturn !== "cancelled") return;
    const next = takeAfterCard();
    if (!next) return;
    const state: AfterCardState | null = cardReturn === "saved" ? { afterCard: next.action } : null;
    navigate(afterCardPath(next.itemId), { replace: true, state });
  }, [cardReturn, navigate]);
  return (
    <DeclutterGate skeleton={<DeclutterHomeSkeleton />} agreedSales={<FinishSalesView />}>
      <DeclutterHome />
      {/* Q2462: the handover chat opens over the page from ?talk=<id> (its notices and the checkout link there). */}
      <HandoverTalkFromLink />
    </DeclutterGate>
  );
}
