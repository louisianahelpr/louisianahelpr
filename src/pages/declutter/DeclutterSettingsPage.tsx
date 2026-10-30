import { Bell, ChevronRight } from "lucide-react";
import { Link } from "react-router-dom";
import AppPage from "@/components/AppPage";
import { BundleDiscountCard } from "@/components/declutter/BundleDiscountCard";
import { ListingDefaultsCard } from "@/components/declutter/DeclutterListingDefaults";
import { PickupTimesCard } from "@/components/declutter/DeclutterPickupTimes";
import { DeclutterSettingsSkeleton } from "@/components/declutter/DeclutterSkeletons";
import { SectionHeading } from "@/components/declutter/DeclutterTradeViews";
import { DeclutterGate } from "@/components/declutter/declutterUi";
import { SellerDeliveryCard } from "@/components/declutter/SellerDeliverySettings";
import { SellPorchPlaces } from "@/components/declutter/SellPorchPlaces";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { usePageTitle } from "@/hooks/usePageTitle";

/**
 * /declutter/settings (owner 2026-10-30: "a settings gear like Jobs"): listing defaults, pickup times, delivery,
 * bundle discount, notifications. Each setting keeps its own save. The 404 unless 'declutter' is on (DeclutterGate).
 */
function DeclutterSettings() {
  usePageTitle("Declutter settings — Helpr");
  const { user } = useCurrentUser();
  if (!user) return null;
  return (
    <AppPage title="Declutter settings" backTo="/declutter?tab=selling">
      <div className="space-y-section pb-6" data-testid="declutter-settings">
        <section className="space-y-2" aria-label="Listing defaults">
          <SectionHeading title="Listing defaults" />
          <ListingDefaultsCard userId={user.id} />
        </section>
        <section className="space-y-2" aria-label="Pickup, delivery and bundles">
          <SectionHeading title="Pickup, delivery and bundles" />
          {/* One card around the rows: a row drops its own card look (the cards' shadow and transparent edge are !important in index.css T2). */}
          <div className="overflow-hidden rounded-[20px] border border-border bg-card [&>section]:!rounded-none [&>section]:!shadow-none [&>section+section]:!border-t [&>section+section]:!border-t-[hsl(var(--border))]">
            <PickupTimesCard userId={user.id} />
            <SellPorchPlaces card />
            <SellerDeliveryCard />
            <BundleDiscountCard />
          </div>
        </section>
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
