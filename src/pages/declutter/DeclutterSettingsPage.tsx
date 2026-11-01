import { Bell, ChevronRight } from "lucide-react";
import { Link } from "react-router-dom";
import AppPage from "@/components/AppPage";
import { ListingDefaultsCard } from "@/components/declutter/DeclutterListingDefaults";
import { DeclutterSettingsSkeleton } from "@/components/declutter/DeclutterSkeletons";
import { SectionHeading } from "@/components/declutter/DeclutterTradeViews";
import { DeclutterGate } from "@/components/declutter/declutterUi";
import { MeetupTimesCard } from "@/components/declutter/MeetupTimesCard";
import { SellPorchPlaces } from "@/components/declutter/SellPorchPlaces";
import { SellMeetupSpots } from "@/components/declutter/SellMeetupSpots";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { usePageTitle } from "@/hooks/usePageTitle";

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
  return (
    <AppPage title="Declutter settings" backTo="/declutter?tab=selling">
      <div className="space-y-section pb-6" data-testid="declutter-settings">
        <SellPorchPlaces card />
        {/* B110 (owner 11-01): the seller's own public meet spots, for buyers choosing Meet up. */}
        <SellMeetupSpots />
        {/* Lead's call 2026-10-31: the usual times are only for meetups, so they show only when a meetup is offered. */}
        <MeetupTimesCard userId={user.id} />
        <section className="space-y-2" aria-label="Listing defaults">
          <SectionHeading title="Listing defaults" />
          <ListingDefaultsCard userId={user.id} />
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
