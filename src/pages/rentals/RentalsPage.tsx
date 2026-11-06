import { RentalsGate } from "@/components/rentals/rentalsUi";
import { SectionGateFrame } from "@/components/sections/SectionGateFrame";
import RentalsHomeView from "@/components/rentals/RentalsHomeView";

/** Rentals S1: "Opens soon" unless the hidden 'rentals' switch is on (RentalsGate sectionRoot);
 * while the switch loads, the settled section header (SectionGateFrame: no back arrow, owner 2026-10-28). */
export default function RentalsPage() {
  return (
    <RentalsGate sectionRoot skeleton={<SectionGateFrame section="homes" label="Loading Homes" />}>
      <RentalsHomeView />
    </RentalsGate>
  );
}
