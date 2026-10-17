import { RentalsGate } from "@/components/rentals/rentalsUi";
import { RentalsGateFrame } from "@/components/rentals/RentalsSkeletons";
import RentalsHomeView from "@/components/rentals/RentalsHomeView";

/** Rentals S1: the 404 unless the hidden 'rentals' switch is on (RentalsGate);
 * while the switch loads, its real header (RentalsGateFrame). */
export default function RentalsPage() {
  return (
    <RentalsGate skeleton={<RentalsGateFrame title="Rentals" label="Loading your rentals" />}>
      <RentalsHomeView />
    </RentalsGate>
  );
}
