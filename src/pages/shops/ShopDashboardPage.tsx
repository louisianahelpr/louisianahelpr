import { ShopsGate } from "@/components/shops/shopsUi";
import ShopDashboardView from "@/components/shops/ShopDashboardView";
import AppPage from "@/components/AppPage";

/** "Opens soon" unless the hidden 'shops' switch is on (ShopsGate, Q2005). */
export default function ShopDashboardPage() {
  return (
    <ShopsGate title="Shop" backTo="/shops">
      {/* One name (shops audit 11-10 F12): "Shop", the tab this same view fills under /shops. The page owns its frame; the dashboard inside is the same one the
          Shops section's Shop tab shows (owner, 2026-10-19). */}
      <AppPage title="Shop" backTo="/shops">
        <ShopDashboardView embedded />
      </AppPage>
    </ShopsGate>
  );
}
