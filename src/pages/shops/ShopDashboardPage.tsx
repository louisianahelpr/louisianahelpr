import { ShopsGate } from "@/components/shops/shopsUi";
import ShopDashboardView from "@/components/shops/ShopDashboardView";
import AppPage from "@/components/AppPage";

/** The 404 unless the hidden 'shops' switch is on (ShopsGate). */
export default function ShopDashboardPage() {
  return (
    <ShopsGate title="Shop dashboard" backTo="/shops">
      {/* The page owns its frame; the dashboard inside is the same one the
          Shops section's Shop tab shows (owner, 2026-10-19). */}
      <AppPage title="Shop dashboard" backTo="/shops">
        <ShopDashboardView embedded />
      </AppPage>
    </ShopsGate>
  );
}
