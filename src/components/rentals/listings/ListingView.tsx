import { Link, useParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import AppPage from "@/components/AppPage";
import { Skeleton } from "@/components/ui/skeleton";
import { fetchListing, listingPhotoUrl } from "@/lib/rentals/listings";
import {
  ACCESSIBILITY_LABEL,
  ASSISTANCE_ANIMALS_LINE,
  PARKING_LABEL,
  PETS_LABEL,
  UTILITY_LABEL,
  VOUCHERS_LABEL,
  availableLine,
  bedsBathsLine,
  listingStatusLabel,
  rentLine,
} from "@/lib/rentals/listingCopy";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { RentalsCard } from "../rentalsUi";

const LISTING_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Whether a /rentals/listings/:id link can name a listing at all (ids are uuids). */
export function isListingId(id: string | undefined): id is string {
  return !!id && LISTING_ID.test(id);
}

export function ListingUnavailable() {
  return (
    <AppPage title="Home for rent" backTo="/rentals">
      <p className="text-sm">This listing isn't available.</p>
    </AppPage>
  );
}

function ListingSkeleton() {
  return (
    <AppPage title="Home for rent" backTo="/rentals">
      <div role="status" aria-label="Loading the listing" className="space-y-3">
        <Skeleton className="h-56 w-full rounded-2xl" aria-hidden />
        <Skeleton className="h-32 w-full rounded-2xl" aria-hidden />
      </div>
    </AppPage>
  );
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-3 text-sm">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="text-right">{value}</dd>
    </div>
  );
}

const dollars = (cents: number) => (cents / 100).toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });

/**
 * /rentals/listings/:id (Homes -> Rent, RL1a): the listing page. Photos,
 * rent, facts, where (city + ZIP only, Q12). The owner sees its status and
 * an Edit link. Applying and messages come in the next slices.
 */
export default function ListingView() {
  const { id } = useParams();
  const { user } = useCurrentUser();
  const valid = isListingId(id);
  const q = useQuery({ queryKey: ["rentals-listing", id], enabled: valid && !!user, queryFn: () => fetchListing(id as string) });
  if (!valid || q.isError || q.data === null) return <ListingUnavailable />;
  if (!q.data) return <ListingSkeleton />;
  const l = q.data;
  const lease =
    l.lease_months_min && l.lease_months_max
      ? l.lease_months_min === l.lease_months_max
        ? `${l.lease_months_min} months`
        : `${l.lease_months_min} to ${l.lease_months_max} months`
      : l.lease_months_min
        ? `At least ${l.lease_months_min} months`
        : l.lease_months_max
          ? `Up to ${l.lease_months_max} months`
          : "Ask the owner";
  return (
    <AppPage title="Home for rent" backTo="/rentals">
      <div className="space-y-4">
        {l.is_mine && (
          <div className="flex items-center justify-between gap-3 rounded-xl border border-border bg-muted p-3 text-sm">
            <span>Your listing: {listingStatusLabel(l.status, l.expires_at)}</span>
            <Link className="font-semibold underline" to={`/rentals/listings/${l.id}/edit`}>
              Edit
            </Link>
          </div>
        )}
        {l.photo_paths.length > 0 && (
          <div role="group" className="flex gap-2 overflow-x-auto snap-x snap-mandatory rounded-2xl" aria-label="Photos">
            {l.photo_paths.map((p, i) => (
              <img
                key={p}
                src={listingPhotoUrl(p)}
                alt={`Photo ${i + 1} of ${l.photo_paths.length}`}
                className="h-56 w-[85%] max-w-md shrink-0 snap-start rounded-2xl object-cover"
                loading={i === 0 ? "eager" : "lazy"}
              />
            ))}
          </div>
        )}
        <section className="space-y-1">
          <h2 className="text-xl font-semibold">{rentLine(l.rent_cents, l.rent_frequency)}</h2>
          <p className="font-medium">{l.headline}</p>
          <p className="text-sm text-muted-foreground">
            {bedsBathsLine(l.beds, l.baths)}
            {l.sq_ft ? ` · ${l.sq_ft.toLocaleString("en-US")} sq ft` : ""} · {l.city} {l.zip_code}
          </p>
          <p className="text-sm">{availableLine(l.available_on)}</p>
        </section>
        {l.description && (
          <RentalsCard title="About this home">
            <p className="text-sm whitespace-pre-line break-words">{l.description}</p>
          </RentalsCard>
        )}
        <RentalsCard title="Details">
          <dl className="space-y-2">
            <Fact label="Deposit" value={l.deposit_cents == null ? "Ask the owner" : dollars(l.deposit_cents)} />
            <Fact label="Lease" value={lease} />
            <Fact label="Pets" value={PETS_LABEL[l.pets] ?? l.pets} />
            <Fact label="Parking" value={PARKING_LABEL[l.parking] ?? l.parking} />
            <Fact label="Utilities included" value={l.utilities_included.length ? l.utilities_included.map((u) => UTILITY_LABEL[u] ?? u).join(", ") : "None"} />
            <Fact label="Housing vouchers" value={VOUCHERS_LABEL[l.accepts_vouchers] ?? l.accepts_vouchers} />
          </dl>
          {l.pet_rules && <p className="text-sm break-words">{l.pet_rules}</p>}
          {l.pets === "none" && <p className="text-sm text-muted-foreground">{ASSISTANCE_ANIMALS_LINE}</p>}
          {l.accessibility.length > 0 && (
            <p className="text-sm">
              <span className="text-muted-foreground">Access: </span>
              {l.accessibility.map((a) => ACCESSIBILITY_LABEL[a] ?? a).join(", ")}
            </p>
          )}
        </RentalsCard>
        <p className="text-xs text-muted-foreground">
          Louisiana Helpr checked that the person listing this home owns it. The street address is not shown here.
        </p>
      </div>
    </AppPage>
  );
}
