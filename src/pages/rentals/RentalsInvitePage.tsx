import { RentalsGate } from "@/components/rentals/rentalsUi";
import { RentalsGateFrame } from "@/components/rentals/RentalsSkeletons";
import RentalsInviteView from "@/components/rentals/RentalsInviteView";

/** Rentals S1: the 404 unless the hidden 'rentals' switch is on (RentalsGate);
 * while the switch loads, its real header (RentalsGateFrame). */
export default function RentalsInvitePage() {
  return (
    <RentalsGate skeleton={<RentalsGateFrame title="Join your rental" backTo="/rentals" label="Loading the invite" />}>
      <RentalsInviteView />
    </RentalsGate>
  );
}
