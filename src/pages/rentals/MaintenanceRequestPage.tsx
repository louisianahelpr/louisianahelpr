import { RentalsGate } from "@/components/rentals/rentalsUi";
import MaintenanceRequestView from "@/components/rentals/MaintenanceRequestView";

/** Rentals S1: the 404 unless the hidden 'rentals' switch is on (RentalsGate). */
export default function MaintenanceRequestPage() {
  return (
    <RentalsGate>
      <MaintenanceRequestView />
    </RentalsGate>
  );
}
