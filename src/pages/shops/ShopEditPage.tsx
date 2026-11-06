import { ShopsGate } from "@/components/shops/shopsUi";
import ShopEditView from "@/components/shops/ShopEditView";

/** "Opens soon" unless the hidden 'shops' switch is on (ShopsGate, Q2005). */
export default function ShopEditPage() {
  return (
    <ShopsGate title="My shop" backTo="/shops">
      <ShopEditView />
    </ShopsGate>
  );
}
