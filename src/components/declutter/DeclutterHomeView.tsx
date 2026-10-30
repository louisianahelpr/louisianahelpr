/**
 * /declutter — Declutter's own tab (spec rows 1, 2). Section dashboard
 * (owner, 2026-10-19): the shared top bar and Browse | Buying | Selling, Browse
 * leftmost and the default; Wanted and Deliver are sub-views at ?view=.
 * Tabs (src/lib/declutter/tabs.ts): Browse (nearest first, a distance
 * filter in the slide-up sheet, area + miles only: rows 5, 27) · Buying (cart, your offers,
 * purchases) · Selling (your listings with every status in plain words, incl.
 * waiting for a review: row 33; offers on your items; sales waiting to be paid;
 * paid sales and payouts) · Deliver · Wanted · Free (the live free items nearby, OWN-FREE). Old links (?view=mine|offers|cart)
 * open the tab that now holds them. Hidden unless the 'declutter' switch is on
 * for the member (DeclutterGate).
 */
import { lazy, Suspense, useEffect, useLayoutEffect, useRef } from "react";
import { HelprSpinner } from "@/components/ui/HelprSpinner";
import { useSearchParams } from "react-router-dom";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { useFeatureStatus } from "@/hooks/useFeature";
import {
  OLD_DECLUTTER_VIEWS,
  oldDeclutterView,
  type DeclutterTab,
  type OldDeclutterView,
} from "@/lib/declutter/tabs";
import { useDeclutterTodo } from "./DeclutterTodo";
import { StrikeCount } from "./DeclutterStrikeCount";
import { useUnansweredQuestions } from "./SellerQuestionsToAnswer";
import { DeclutterBrowse, type DeclutterBrowseHeader } from "./DeclutterBrowseView";
import { SectionScreen } from "@/components/sections/SectionScreen";
import { SectionTabs, useSectionTab } from "@/components/sections/SectionTabs";
import { useArrivalGate } from "@/hooks/useArrivalGate";
import { DeclutterHomeSkeleton } from "./DeclutterSkeletons";

// Only Browse is on this page's first screen. Every other tab loads on its own: statically here they put 134 chunks
// and 612 KB gz in front of the first photo on a slow phone (Lighthouse, 2026-10-30; numbers on the commit).
const DeliverView = lazy(() => import("./DeclutterDeliveryViews").then((m) => ({ default: m.DeliverView })));
const SellingView = lazy(() => import("./DeclutterSellingTab").then((m) => ({ default: m.SellingView })));
const BuyingTab = lazy(() => import("./DeclutterBuyingTab").then((m) => ({ default: m.BuyingTab })));
const FreeView = lazy(() => import("./DeclutterFreeView").then((m) => ({ default: m.FreeView })));
const WantedView = lazy(() => import("./DeclutterWantedViews").then((m) => ({ default: m.WantedView })));
const OrdersUpdating = lazy(() => import("./OrdersUpdating").then((m) => ({ default: m.OrdersUpdating })));

const MINE_TABS = ["buying", "selling", "deliver"] as const; // Deliver tab: owner 2026-10-28
// The Wanted tab (owner 2026-10-28, "Both": the tab AND Browse's bottom link), only while 'declutter_wanted' is on.
// The Free tab, last, next to Wanted (OWN-FREE, owner via the lead 2026-10-30): for everyone, as the Free section is.
const MINE_TABS_FREE = [...MINE_TABS, "free"] as const;
const MINE_TABS_WITH_WANTED = [...MINE_TABS, "wanted", "free"] as const;

/**
 * Five tabs do not fit one line at 375 (Browse's count and two badges): the row scrolls sideways (SectionTabs'
 * overflow-x-auto), so the selected tab is scrolled into the row's view whenever it changes, never left off-screen.
 */
function useSelectedTabInView(view: string) {
  const ref = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const list = ref.current?.querySelector<HTMLElement>('[role="tablist"]');
    const tab = list?.querySelector<HTMLElement>('[role="tab"][aria-selected="true"]');
    if (!list || !tab) return;
    const l = list.getBoundingClientRect();
    const t = tab.getBoundingClientRect();
    if (t.right > l.right) list.scrollLeft += t.right - l.right;
    else if (t.left < l.left) list.scrollLeft -= l.left - t.left;
  }, [view]);
  return ref;
}

export default function DeclutterHome() {
  const { user } = useCurrentUser();
  const [params, setParams] = useSearchParams();
  // W14: "Wanted" exists only while its own switch is on for this member.
  // The tab row waits for that answer (Q?declutter-settle): painted before it,
  // the Wanted tab arrived ~20 ms later and, at 375, wrapped the row onto a
  // third line that pushed the whole view 46px down. DeclutterPage starts the
  // read alongside the 'declutter' one, so the wait is usually nothing.
  const wanted = useFeatureStatus("declutter_wanted");
  // The haul-away and moving-out switches shape My listings the same way, so
  // they are read here and waited for with it (one paint, no late card).
  const haulAway = useFeatureStatus("declutter_haul_away");
  const movingOut = useFeatureStatus("declutter_moving_out");
  // The Buying / Selling badges (what needs the member) are read with the
  // switches and waited for with them: a count landing after the tab row
  // painted would widen its tab and could re-wrap the row (Q?declutter-settle).
  // The same reads fill the Buying and Selling tabs, so those open filled.
  const { todo, settled: todoSettled } = useDeclutterTodo();
  // Audit DC-9: the Selling badge counts what "To answer" counts, questions too (the chip's own cached read).
  const questions = useUnansweredQuestions(user?.id);
  const tabsReady = useArrivalGate(true, wanted.settled && haulAway.settled && movingOut.settled && todoSettled && questions.settled);
  const wantedOn = wanted.on;
  const [sectionTab] = useSectionTab<DeclutterTab>(wantedOn ? MINE_TABS_WITH_WANTED : MINE_TABS_FREE);
  const asked = params.get("view");
  const legacy = OLD_DECLUTTER_VIEWS.includes(asked as OldDeclutterView) ? (asked as OldDeclutterView) : null;
  // ?view= is the pre-2026-10-19 address (still in sent notifications and
  // emails): mine|offers|cart open their tab; deliver and wanted stay sub-views
  // (Wanted only while its switch is on; its tab is hidden, owner 2026-10-19).
  const subView: "deliver" | "wanted" | null = asked === "deliver" ? "deliver" : asked === "wanted" && wantedOn ? "wanted" : null;
  const fromView: DeclutterTab | null = legacy ? oldDeclutterView(legacy, todo) : asked === "buying" || asked === "selling" ? asked : null;
  const view: DeclutterTab = subView ?? fromView ?? sectionTab;
  const tabRowRef = useSelectedTabInView(tabsReady ? view : "");
  // An old ?view= link is rewritten to ?tab= once the badges' reads are in
  // (they decide which side an offers/cart link meant), keeping its other params.
  useEffect(() => {
    if (!fromView || !tabsReady) return;
    setParams((p) => {
      const next = new URLSearchParams(p);
      next.delete("view");
      if (fromView === "browse") next.delete("tab");
      else next.set("tab", fromView);
      return next;
    }, { replace: true });
  }, [fromView, tabsReady, setParams]);
  if (!user) return null;
  if (!tabsReady) return <DeclutterHomeSkeleton />;
  // Browse adds its count and (desktop) search, filters and map at the row's end, or (phone) its search row under
  // the tabs: Jobs' layout (owner 2026-10-28, DeclutterBrowseView).
  const tabsFor = (browse?: DeclutterBrowseHeader) => (
    <>
    <div ref={tabRowRef} className="contents">
    <SectionTabs
      label="Declutter view"
      browseCount={browse?.count}
      end={browse?.end}
      value={view}
      onChange={(v) =>
        setParams((p) => {
          const next = new URLSearchParams(p);
          next.delete("view");
          next.delete("status");
          if (v === "browse") next.delete("tab");
          else next.set("tab", v);
          return next;
        }, { replace: true })
      }
      tabs={[
        { value: "buying", label: "Buying", count: todo?.buying },
        { value: "selling", label: "Selling", count: todo ? todo.selling + questions.count : undefined },
        { value: "deliver", label: "Deliver" },
        ...(wantedOn ? [{ value: "wanted" as const, label: "Wanted" }] : []),
        { value: "free", label: "Free" },
      ]}
    />
    </div>
    {browse?.below}
    </>
  );
  // Browse draws its own section screen, so its tabs row can carry its search, filters, map toggle and count.
  if (view === "browse") return <DeclutterBrowse userId={user.id} tabs={tabsFor} top={<StrikeCount userId={user.id} />} />;
  return (
    // Browse (above) draws its own "Search items", so Explore's global search shows only on Deliver and Wanted. Not on
    // Buying (lead walkthrough 2026-10-28, shot 05) or Selling (owner 2026-10-28): a member's own cart, offers,
    // listings and sales are not what "Search all sections" finds.
    <SectionScreen section="declutter" title="Declutter" globalSearch={view !== "buying" && view !== "selling"} tabs={tabsFor()}>
      <StrikeCount userId={user.id} />
      {/* A tab the member has not opened yet shows the spinner for its own chunk; its loaded form is unchanged. */}
      <Suspense fallback={<HelprSpinner />}>
        {(view === "buying" || view === "selling") && <OrdersUpdating />}
        {view === "buying" ? <BuyingTab todo={todo} />
            : view === "selling" ? <SellingView userId={user.id} haulOn={haulAway.on} movingOutOn={movingOut.on} todo={todo} />
              : view === "deliver" ? <DeliverView />
                : view === "free" ? <FreeView userId={user.id} />
                  : <WantedView />}
      </Suspense>
    </SectionScreen>
  );
}
