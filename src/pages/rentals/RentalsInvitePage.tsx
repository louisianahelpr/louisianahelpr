import { RentalsGate } from "@/components/rentals/rentalsUi";
import RentalsInviteView from "@/components/rentals/RentalsInviteView";

/** Rentals S1: the 404 unless the hidden 'rentals' switch is on (RentalsGate). */
export default function RentalsInvitePage() {
  return (
    <RentalsGate>
      <RentalsInviteView />
    </RentalsGate>
  );
}
