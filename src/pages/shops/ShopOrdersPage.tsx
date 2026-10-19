import { ShopsGate } from "@/components/shops/shopsUi";
import ShopMyOrdersView from "@/components/shops/ShopMyOrdersView";
import AppPage from "@/components/AppPage";

/** The 404 unless the hidden 'shops' switch is on (ShopsGate). */
export default function ShopOrdersPage() {
  return (
    <ShopsGate title="My orders" backTo="/shops">
      {/* The page owns its frame; the list inside is the same one the Shops
          section's Orders tab shows (owner, 2026-10-19: one component per thing). */}
      <AppPage title="My orders" backTo="/shops">
        <ShopMyOrdersView embedded />
      </AppPage>
    </ShopsGate>
  );
}
