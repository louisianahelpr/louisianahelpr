import { DeclutterGate } from "@/components/declutter/declutterUi";
import { DeclutterHomeSkeleton } from "@/components/declutter/DeclutterSkeletons";
import DeclutterHome from "@/components/declutter/DeclutterHomeView";
import { OrderTalkFromLink } from "@/components/declutter/DeclutterOrderTalk";
import { lazy, Suspense, useEffect } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useFeatureStatus } from "@/hooks/useFeature";
import { afterCardPath, afterCardReturnState, takeAfterCard } from "@/lib/declutter/afterCard";

// Loaded only when drawn (lead 11-01, the /declutter order chunk): the switched-off sales view, and the handover chat
// that opens from ?talk=<id>. Statically imported, both pulled the order and handover views (~24 KB gz) into every
// /declutter first screen. Guard: src/test/declutterTabsLoadOnDemand.test.ts.
const FinishSalesView = lazy(() => import("@/components/declutter/DeclutterTradeViews").then((m) => ({ default: m.FinishSalesView })));
const HandoverTalkFromLink = lazy(() => import("@/components/declutter/DeclutterHandoverTalk").then((m) => ({ default: m.HandoverTalkFromLink })));

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
    navigate(afterCardPath(next.itemId), { replace: true, state: afterCardReturnState(cardReturn === "saved", next) });
  }, [cardReturn, navigate]);
  return (
    <>
      <DeclutterGate skeleton={<DeclutterHomeSkeleton />} agreedSales={<Suspense fallback={<DeclutterHomeSkeleton />}><FinishSalesView /></Suspense>}>
        <DeclutterHome />
        {/* Q2462: the handover chat opens over the page from ?talk=<id> (its notices and the checkout link there). */}
        {params.get("talk") && <Suspense fallback={null}><HandoverTalkFromLink /></Suspense>}
      </DeclutterGate>
      {/* D2-1: the paid-order chat opens over the page from ?order_talk=<order id> (the button on each paid order, its
          notices). OUTSIDE the gate: a paid sale carries on with Declutter switched off (row 62), and the gate drew
          its children only while the switch was on, so a notice's link opened nothing. The server decides who may
          read it (the order's buyer or seller only). */}
      <OrderTalkFromLink />
    </>
  );
}
