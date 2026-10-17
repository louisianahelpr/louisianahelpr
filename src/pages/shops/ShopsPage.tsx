import { ShopsGate } from "@/components/shops/shopsUi";
import ShopsHomeView from "@/components/shops/ShopsHomeView";

/** The 404 unless the hidden 'shops' switch is on (ShopsGate). */
export default function ShopsPage() {
  return (
    <ShopsGate title="Shops">
      <ShopsHomeView />
    </ShopsGate>
  );
}
