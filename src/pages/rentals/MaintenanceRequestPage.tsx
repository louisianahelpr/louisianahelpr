import { RentalsGate } from "@/components/rentals/rentalsUi";
import { useParams } from "react-router-dom";
import { MaintenanceRequestUnavailable, RentalsGateFrame, isRequestId } from "@/components/rentals/RentalsSkeletons";
import MaintenanceRequestView from "@/components/rentals/MaintenanceRequestView";

/** Rentals S1: the 404 unless the hidden 'rentals' switch is on (RentalsGate);
 * while the switch loads, its real header (RentalsGateFrame). */
export default function MaintenanceRequestPage() {
  const { id } = useParams();
  return (
    <RentalsGate skeleton={isRequestId(id) ? <RentalsGateFrame title="Repair request" backTo="/rentals" label="Loading the request" /> : <MaintenanceRequestUnavailable />}>
      <MaintenanceRequestView />
    </RentalsGate>
  );
}
