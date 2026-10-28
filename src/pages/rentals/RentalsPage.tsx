import { RentalsGate } from "@/components/rentals/rentalsUi";
import { SectionGateFrame } from "@/components/sections/SectionScreen";
import RentalsHomeView from "@/components/rentals/RentalsHomeView";

/** Rentals S1: the 404 unless the hidden 'rentals' switch is on (RentalsGate);
 * while the switch loads, the settled section header (SectionGateFrame: no back arrow, owner 2026-10-28). */
export default function RentalsPage() {
  return (
    <RentalsGate skeleton={<SectionGateFrame section="homes" label="Loading Homes" />}>
      <RentalsHomeView />
    </RentalsGate>
  );
}
