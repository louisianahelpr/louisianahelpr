import { RentalsGate } from "@/components/rentals/rentalsUi";
import RentalsHomeView from "@/components/rentals/RentalsHomeView";

/** Rentals S1: the 404 unless the hidden 'rentals' switch is on (RentalsGate). */
export default function RentalsPage() {
  return (
    <RentalsGate>
      <RentalsHomeView />
    </RentalsGate>
  );
}
