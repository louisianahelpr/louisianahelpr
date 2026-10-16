import { ShopsGate } from "@/components/shops/shopsUi";
import ShopEditView from "@/components/shops/ShopEditView";

/** The 404 unless the hidden 'shops' switch is on (ShopsGate). */
export default function ShopEditPage() {
  return (
    <ShopsGate title="My shop" backTo="/shops">
      <ShopEditView />
    </ShopsGate>
  );
}
