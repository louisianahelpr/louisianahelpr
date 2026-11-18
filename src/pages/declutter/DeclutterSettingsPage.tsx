import { Bell, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Link } from "react-router-dom";
import { useQueries } from "@tanstack/react-query";
import AppPage from "@/components/AppPage";
import { ListingDefaultsCard } from "@/components/declutter/DeclutterListingDefaults";
import { DeclutterSettingsSkeleton } from "@/components/declutter/DeclutterSkeletons";
import { myItemsQuery } from "@/components/declutter/myItemsQuery";
import { MY_SELLER_DELIVERY_KEY } from "@/components/declutter/SellerDeliverySettings";
import { SectionHeading } from "@/components/declutter/DeclutterTradeViews";
import { DeclutterGate } from "@/components/declutter/declutterUi";
import { MeetupTimesCard } from "@/components/declutter/MeetupTimesCard";
import { SellPorchPlaces } from "@/components/declutter/SellPorchPlaces";
import { SellMeetupSpots } from "@/components/declutter/SellMeetupSpots";
import { useArrivalGate } from "@/hooks/useArrivalGate";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { useFeature } from "@/hooks/useFeature";
import { usePageTitle } from "@/hooks/usePageTitle";
import { fetchMyPickupWindows } from "@/lib/declutter/api";
import { fetchBundleRule } from "@/lib/declutter/bundle";
import { fetchLastSetup } from "@/lib/declutter/lastSetup";
import { MY_MEETUP_SPOTS_KEY, fetchMeetupSuggestions, fetchMyMeetupSpots } from "@/lib/declutter/meetup";
import { MY_PORCH_PLACES_KEY, fetchMyPorchPlaces } from "@/lib/declutter/porchPlaces";
import { fetchSellerDefaults } from "@/lib/declutter/sellerDefaults";
import { fetchMySellerDelivery } from "@/lib/declutter/sellerDelivery";

/** The page's index (F346): each name is the aria-label of a section on this page. */
const SETTINGS_INDEX = ["Pickup places", "Meet spots", "Listing defaults", "Notifications"] as const;
/** Area 06b L6: Meet spots is headed by its own h2 (aria-labelledby), so its index chip finds it by its test id. */
const INDEX_TARGET: Partial<Record<(typeof SETTINGS_INDEX)[number], string>> = { "Meet spots": '[data-testid="sell-meetup-spots"]' };

/**
 * ONE SETTLED PAINT (Q169; prod-audit 43691657529 on 2026-11-15 page-settle): each card read its own data and grew when it landed
 * (pickup places from a "Loading" row to 342px, then the police-spot suggestions, the meetup-times card and listing
 * defaults), so the page jumped twice: CLS 0.38 at 375 and 0.25 at 1440. The page now observes the same queries (same
 * keys and functions, so no extra request) and shows its bones until every one has answered (an error is an answer
 * too), then paints every card in one commit. Places and defaults are the main reads; the rest may hold the paint for
 * at most ARRIVAL_CAP_MS after them (useArrivalGate), so a hung read never keeps the page on its bones.
 * Guard: src/pages/declutter/declutterSettingsOnePaint.test.tsx.
 */
function useSettingsReadsSettled(userId: string): boolean {
  const bundleOn = useFeature("declutter");
  const deliveryOn = useFeature("declutter_seller_delivery");
  const [places, defaults, windows, spots, suggestions, items, bundle] = useQueries({
    queries: [
      { queryKey: MY_PORCH_PLACES_KEY, queryFn: fetchMyPorchPlaces },
      { queryKey: ["declutter", "seller-defaults", userId], queryFn: () => fetchSellerDefaults(userId) },
      { queryKey: ["declutter", "windows", userId], queryFn: () => fetchMyPickupWindows(userId) },
      { queryKey: MY_MEETUP_SPOTS_KEY, queryFn: fetchMyMeetupSpots },
      { queryKey: ["declutter", "meetup-suggestions"], queryFn: fetchMeetupSuggestions, staleTime: 10 * 60_000 },
      myItemsQuery(userId),
      { queryKey: ["declutter", "bundle-rule", userId], queryFn: () => fetchBundleRule(userId), enabled: bundleOn },
    ],
  });
  // Reads that depend on another, enabled in the same render the cards enable them: the last listing's area while no
  // place is saved (SellPorchPlaces), and the delivery terms under a ticked "I'll deliver" (SellerDeliveryDetails).
  const noPlaces = Array.isArray(places.data) && places.data.length === 0;
  const delivers = deliveryOn && !!defaults.data?.handovers.includes("seller_delivery");
  const [last, delivery] = useQueries({
    queries: [
      { queryKey: ["declutter", "last-setup", userId], queryFn: () => fetchLastSetup(userId), enabled: noPlaces, staleTime: 60_000 },
      { queryKey: MY_SELLER_DELIVERY_KEY, queryFn: fetchMySellerDelivery, enabled: delivers },
    ],
  });
  // Settled: answered, or not asked for. Status, not isFetching: an enabled read that has not started is not settled.
  const settled = (q: { status: string }, asked = true) => !asked || q.status !== "pending";
  const primary = settled(places) && settled(defaults);
  const secondary = settled(windows) && settled(spots) && settled(suggestions) && settled(items)
    && settled(bundle, bundleOn) && settled(last, noPlaces) && settled(delivery, delivers);
  return useArrivalGate(primary, secondary);
}

/**
 * /declutter/settings (owner 2026-10-30: "a settings gear like Jobs"): pickup places (each with its own days and hours;
 * the separate Pickup times card is gone, LEAD-PLACE-TIMES owner 2026-10-31), listing defaults (with the bundle
 * discount and the delivery terms), notifications. Each setting keeps its own save. Places come first: under the other
 * settings they sat at y 1507 at 375 and sellers couldn't find how to add a second address. The 404 unless 'declutter' is on (DeclutterGate).
 */
function DeclutterSettings() {
  usePageTitle("Declutter settings — Helpr");
  const { user } = useCurrentUser();
  if (!user) return null;
  return <DeclutterSettingsBody user={user} />;
}

function DeclutterSettingsBody({ user }: { user: { id: string } }) {
  const ready = useSettingsReadsSettled(user.id);
  if (!ready) return <DeclutterSettingsSkeleton />;
  return (
    <AppPage title="Declutter settings" backTo="/declutter?tab=selling">
      <div className="space-y-section pb-6" data-testid="declutter-settings">
        {/* Q2574 (audit 1102a): Browse's gear opens this page, and a buyer met only seller setup (places, meet spots,
            listing defaults) with Notifications, the one part for them, below a long scroll. The seller block says it
            is for selling; places still come first in it (sellers couldn't find how to add a second address). */}
        <section className="space-y-2" aria-label="Selling" data-settings-selling="">
          <SectionHeading title="Selling" />
          {/* Audit 11-10 F346: "Notifications ... are at the end." was an odd first line; a short index says what is on
              the page and still takes a buyer straight to Notifications (Q2574). */}
          {/* Area 06b L6 (design audit 11-18): 44px chips, Meet spots included (were 19px text links that skipped it). */}
          <nav aria-label="On this page" className="flex flex-wrap items-center gap-2" data-settings-index="">
            {SETTINGS_INDEX.map((name) => (
              <Button key={name} variant="ghost" size="wrapSm" data-settings-index-chip=""
                className="border border-border bg-card font-medium tracking-normal text-foreground"
                onClick={() => document.querySelector(INDEX_TARGET[name] ?? `section[aria-label="${name}"]`)?.scrollIntoView({ behavior: "smooth", block: "start" })}>{name}</Button>
            ))}
          </nav>
          <div className="space-y-section">
            <SellPorchPlaces card />
            {/* B110 (owner 11-01): the seller's own public meet spots, for buyers choosing Meet up. */}
            <SellMeetupSpots />
            {/* Lead's call 2026-10-31: the usual times are only for meetups, so they show only when a meetup is offered. */}
            <MeetupTimesCard userId={user.id} />
            <section className="space-y-2" aria-label="Listing defaults">
              <SectionHeading title="Listing defaults" />
              <ListingDefaultsCard userId={user.id} />
            </section>
          </div>
        </section>
        {/* LEAD-BUNDLE-DROPDOWN / LEAD-DELIVER-TWICE (owner 2026-10-31): the bundle discount is a row in Listing defaults
            under the free-after row, and delivery's price and times open under its "I'll deliver" tick, so the old
            "Delivery and bundles" section is gone. */}
        <section className="space-y-2" aria-label="Notifications">
          <SectionHeading title="Notifications" />
          <Link
            to="/profile?tab=notifications&show=declutter"
            className="flex min-h-11 items-center gap-3 rounded-[20px] border border-border bg-card px-4 py-3 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <Bell className="h-5 w-5 shrink-0" aria-hidden />
            <span className="min-w-0 flex-1">
              <span className="block text-sm font-semibold">Declutter notifications</span>
              <span className="block text-xs text-muted-foreground">Choose what you hear about buying and selling</span>
            </span>
            <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
          </Link>
        </section>
      </div>
    </AppPage>
  );
}

export default function DeclutterSettingsPage() {
  return (
    <DeclutterGate skeleton={<DeclutterSettingsSkeleton />}>
      <DeclutterSettings />
    </DeclutterGate>
  );
}
