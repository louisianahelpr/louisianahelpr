import { ShopsGate } from "@/components/shops/shopsUi";
import ShopMyOrdersView from "@/components/shops/ShopMyOrdersView";

/** The 404 unless the hidden 'shops' switch is on (ShopsGate). */
export default function ShopOrdersPage() {
  return (
    <ShopsGate title="My orders" backTo="/shops">
      <ShopMyOrdersView />
    </ShopsGate>
  );
}
