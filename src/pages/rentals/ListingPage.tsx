import { useParams } from "react-router-dom";
import { RentalsGate } from "@/components/rentals/rentalsUi";
import { RentalsGateFrame } from "@/components/rentals/RentalsSkeletons";
import ListingView, { ListingUnavailable, isListingId } from "@/components/rentals/listings/ListingView";

/** Homes -> Rent listing page: the 404 unless the hidden 'rentals' switch is on (RentalsGate). */
export default function ListingPage() {
  const { id } = useParams();
  return (
    <RentalsGate skeleton={isListingId(id) ? <RentalsGateFrame title="Home for rent" backTo="/rentals" label="Loading the listing" /> : <ListingUnavailable />}>
      <ListingView />
    </RentalsGate>
  );
}
