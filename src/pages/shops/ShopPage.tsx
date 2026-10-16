import { ShopsGate } from "@/components/shops/shopsUi";
import ShopView from "@/components/shops/ShopView";

/** The 404 unless the hidden 'shops' switch is on (ShopsGate). */
export default function ShopPage() {
  return (
    <ShopsGate title="Shop" backTo="/shops">
      <ShopView />
    </ShopsGate>
  );
}
