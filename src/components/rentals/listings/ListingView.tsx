import { useState } from "react";
import { Link, useParams } from "react-router-dom";
import { Home, ShieldCheck } from "lucide-react";
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
  priceLine,
  rentLine,
  SALE_HOW_IT_WORKS,
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
        <Skeleton className="aspect-[16/10] w-full rounded-2xl" aria-hidden />
        <Skeleton className="h-7 w-40" aria-hidden />
        <Skeleton className="h-5 w-3/4" aria-hidden />
        <Skeleton className="h-32 w-full rounded-2xl" aria-hidden />
      </div>
    </AppPage>
  );
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-4 py-3 text-ds-15 first:pt-0 last:pb-0">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="text-right font-medium">{value}</dd>
    </div>
  );
}

/**
 * The photos, full width at the top (Airbnb/Zillow): one photo per screen
 * width, swiped sideways, with a "1 / 8" count. No photos (or none loaded
 * yet) shows the same frame with a house mark, so the page never starts with
 * a hole.
 */
function Gallery({ refs }: { refs: string[] }) {
  const [at, setAt] = useState(0);
  if (refs.length === 0) {
    return (
      <div className="flex aspect-[16/10] w-full items-center justify-center rounded-2xl bg-muted text-muted-foreground" aria-hidden>
        <Home className="h-10 w-10" />
      </div>
    );
  }
  return (
    <div className="relative">
      <div
        role="group"
        aria-label="Photos"
        className="flex snap-x snap-mandatory overflow-x-auto rounded-2xl [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
        onScroll={(e) => {
          const el = e.currentTarget;
          setAt(Math.round(el.scrollLeft / Math.max(1, el.clientWidth)));
        }}
      >
        {refs.map((p, i) => (
          <img
            key={p}
            src={listingPhotoUrl(p, 1200)}
            alt={`Photo ${i + 1} of ${refs.length}`}
            className="aspect-[16/10] w-full shrink-0 snap-center bg-muted object-cover"
            loading={i === 0 ? "eager" : "lazy"}
          />
        ))}
      </div>
      {refs.length > 1 && (
        <span className="pointer-events-none absolute bottom-3 right-3 rounded-full bg-black/60 px-2.5 py-1 text-ds-12 font-semibold text-white" aria-hidden>
          {Math.min(at, refs.length - 1) + 1} / {refs.length}
        </span>
      )}
    </div>
  );
}

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
  const sale = l.kind === "sale";
  return (
    <AppPage title={sale ? "Home for sale" : "Home for rent"} backTo={sale ? "/rentals?kind=buy" : "/rentals"}>
      <div className="max-w-3xl space-y-6">
        <Gallery refs={l.photo_refs} />
        {l.is_mine && (
          <div className="flex items-center justify-between gap-3 rounded-2xl bg-muted px-4 py-3 text-ds-14">
            <span>Your listing: {listingStatusLabel(l.status, l.expires_at)}</span>
            <Link className="font-semibold underline underline-offset-2" to={`/rentals/listings/${l.id}/edit`}>
              Edit
            </Link>
          </div>
        )}
        <section className="space-y-1 px-1">
          <h2 className="text-ds-24 font-bold">{sale ? priceLine(l.sale_price_cents) : rentLine(l.rent_cents, l.rent_frequency)}</h2>
          <p className="text-ds-17 font-medium">{l.headline}</p>
          <p className="text-ds-15 text-muted-foreground">
            {bedsBathsLine(l.beds, l.baths)}
            {l.sq_ft ? ` · ${l.sq_ft.toLocaleString("en-US")} sq ft` : ""} · {l.city} {l.zip_code}
          </p>
          {!sale && <p className="text-ds-15">{availableLine(l.available_on)}</p>}
        </section>
        {l.description && (
          <RentalsCard title="About this home">
            <p className="text-ds-15 whitespace-pre-line break-words">{l.description}</p>
          </RentalsCard>
        )}
        {sale ? (
          <RentalsCard title="Details">
            <dl className="divide-y divide-border">
              {l.year_built ? <Fact label="Year built" value={String(l.year_built)} /> : null}
              {l.lot_sq_ft ? <Fact label="Lot size" value={`${l.lot_sq_ft.toLocaleString("en-US")} sq ft`} /> : null}
              <Fact label="Parking" value={PARKING_LABEL[l.parking] ?? l.parking} />
            </dl>
            {l.accessibility.length > 0 && (
              <p className="text-ds-14">
                <span className="text-muted-foreground">Access: </span>
                {l.accessibility.map((a) => ACCESSIBILITY_LABEL[a] ?? a).join(", ")}
              </p>
            )}
          </RentalsCard>
        ) : (
        <RentalsCard title="Details">
          <dl className="divide-y divide-border">
            <Fact label="Deposit" value={l.deposit_cents == null ? "Ask the owner" : priceLine(l.deposit_cents)} />
            <Fact label="Lease" value={lease} />
            <Fact label="Pets" value={PETS_LABEL[l.pets] ?? l.pets} />
            <Fact label="Parking" value={PARKING_LABEL[l.parking] ?? l.parking} />
            <Fact label="Utilities included" value={l.utilities_included.length ? l.utilities_included.map((u) => UTILITY_LABEL[u] ?? u).join(", ") : "None"} />
            <Fact label="Housing vouchers" value={VOUCHERS_LABEL[l.accepts_vouchers] ?? l.accepts_vouchers} />
          </dl>
          {l.pet_rules && <p className="text-ds-14 break-words">{l.pet_rules}</p>}
          {l.pets === "none" && <p className="text-ds-14 text-muted-foreground">{ASSISTANCE_ANIMALS_LINE}</p>}
          {l.accessibility.length > 0 && (
            <p className="text-ds-14">
              <span className="text-muted-foreground">Access: </span>
              {l.accessibility.map((a) => ACCESSIBILITY_LABEL[a] ?? a).join(", ")}
            </p>
          )}
        </RentalsCard>
        )}
        {sale && <p className="px-1 text-ds-14">{SALE_HOW_IT_WORKS}</p>}
        <p className="flex items-start gap-2 px-1 text-ds-13 text-muted-foreground">
          <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
          <span>Louisiana Helpr checked that the person listing this home owns it. The street address is not shown here.</span>
        </p>
      </div>
    </AppPage>
  );
}
