import { ShopsGate } from "@/components/shops/shopsUi";
import ShopsHomeView from "@/components/shops/ShopsHomeView";
import { SectionGateFrame } from "@/components/sections/SectionGateFrame";

/** The 404 unless the hidden 'shops' switch is on (ShopsGate); while it loads, the settled section header
 * (SectionGateFrame: no back arrow, owner 2026-10-28). */
export default function ShopsPage() {
  return (
    <ShopsGate title="Shops" skeleton={<SectionGateFrame section="shops" label="Loading Shops" />}>
      <ShopsHomeView />
    </ShopsGate>
  );
}
