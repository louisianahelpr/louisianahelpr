import { ShopsGate } from "@/components/shops/shopsUi";
import ShopDashboardView from "@/components/shops/ShopDashboardView";

/** The 404 unless the hidden 'shops' switch is on (ShopsGate). */
export default function ShopDashboardPage() {
  return (
    <ShopsGate title="Shop dashboard" backTo="/shops">
      <ShopDashboardView />
    </ShopsGate>
  );
}
