import { useParams } from "react-router-dom";
import { RentalsGate } from "@/components/rentals/rentalsUi";
import { RentalsGateFrame } from "@/components/rentals/RentalsSkeletons";
import ListingEditor from "@/components/rentals/listings/ListingEditor";

/** Homes -> Rent listing editor (new and edit): the 404 unless the hidden 'rentals' switch is on (RentalsGate). */
export default function ListingEditPage() {
  const { id } = useParams();
  return (
    <RentalsGate skeleton={<RentalsGateFrame title={id ? "Edit listing" : "List a home for rent"} backTo="/rentals" label="Loading the listing" />}>
      <ListingEditor />
    </RentalsGate>
  );
}
