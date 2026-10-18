import { useState } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { ErrorState } from "@/components/ui/ErrorState";
import { fetchBrowseListings, listingPhotoUrl, type BrowseListing } from "@/lib/rentals/listings";
import { availableLine, bedsBathsLine, rentLine } from "@/lib/rentals/listingCopy";
import { dollarsToCents } from "@/lib/rentals/copy";
import { RentalsCard, fieldSelectClass } from "../rentalsUi";

/**
 * Homes -> Rent: "Homes for rent" (RL1a). Live listings near the member,
 * filtered by FACTS about the home only (place, bedrooms, rent): never a
 * filter about who may live there (fair housing, spec 6a). The card shows the
 * city and ZIP, never the street (Q12).
 */
function ListingCard({ l }: { l: BrowseListing }) {
  const cover = l.photo_paths?.[0];
  return (
    <Link
      to={`/rentals/listings/${l.id}`}
      className="group block overflow-hidden rounded-2xl border border-border bg-card transition-shadow hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      {cover ? (
        <img src={listingPhotoUrl(cover)} alt="" className="aspect-[4/3] w-full bg-muted object-cover" loading="lazy" />
      ) : (
        <span className="block aspect-[4/3] w-full bg-muted" aria-hidden />
      )}
      <span className="block space-y-0.5 p-3">
        <span className="block text-base font-semibold">{rentLine(l.rent_cents, l.rent_frequency)}</span>
        <span className="block truncate text-sm" title={l.headline}>{l.headline}</span>
        <span className="block text-xs text-muted-foreground">
          {bedsBathsLine(l.beds, l.baths)} · {l.city} {l.zip_code}
        </span>
        <span className="block text-xs text-muted-foreground">
          {availableLine(l.available_on)}
          {l.is_mine ? " · Your listing" : ""}
        </span>
      </span>
    </Link>
  );
}

/** One results grid for the list and its loading bones, so nothing moves when the list arrives. */
const GRID = "grid gap-3 sm:grid-cols-2 xl:grid-cols-3";

function ListingCardBone() {
  return (
    <div className="overflow-hidden rounded-2xl border border-border" aria-hidden>
      <Skeleton className="aspect-[4/3] w-full rounded-none" />
      <div className="space-y-1.5 p-3">
        <Skeleton className="h-5 w-24" />
        <Skeleton className="h-4 w-3/4" />
        <Skeleton className="h-3 w-1/2" />
        <Skeleton className="h-3 w-1/3" />
      </div>
    </div>
  );
}

export function RentBrowse() {
  const [place, setPlace] = useState("");
  const [minBeds, setMinBeds] = useState("");
  const [maxRent, setMaxRent] = useState("");
  const [applied, setApplied] = useState({ city: "", minBeds: null as number | null, maxRentCents: null as number | null });
  const q = useQuery({
    queryKey: ["rentals-browse", applied],
    queryFn: () => fetchBrowseListings(applied),
  });
  return (
    <RentalsCard title="Homes for rent">
      <form
        className="space-y-2"
        aria-label="Search homes for rent"
        onSubmit={(e) => {
          e.preventDefault();
          setApplied({ city: place, minBeds: minBeds ? Number(minBeds) : null, maxRentCents: maxRent ? dollarsToCents(maxRent) : null });
        }}
      >
        <div className="flex items-center gap-2">
          <Input className="flex-1 min-w-0" aria-label="City or ZIP" placeholder="City or ZIP" value={place} onChange={(e) => setPlace(e.target.value)} />
          <Button type="submit" size="sm" className="shrink-0">
            Search
          </Button>
        </div>
        <div className="flex gap-2">
          <select
            aria-label="Bedrooms"
            className={`${fieldSelectClass} flex-1 min-w-0`}
            value={minBeds}
            onChange={(e) => setMinBeds(e.target.value)}
          >
            <option value="">Any bedrooms</option>
            <option value="1">1+ bedrooms</option>
            <option value="2">2+ bedrooms</option>
            <option value="3">3+ bedrooms</option>
            <option value="4">4+ bedrooms</option>
          </select>
          <Input
            className="flex-1 min-w-0"
            aria-label="Most rent per month, in dollars"
            placeholder="Max rent $"
            inputMode="decimal"
            value={maxRent}
            onChange={(e) => setMaxRent(e.target.value)}
          />
        </div>
      </form>
      {q.isError ? (
        <ErrorState onRetry={() => q.refetch()} />
      ) : !q.data ? (
        <div role="status" aria-label="Loading homes for rent" className={GRID}>
          <ListingCardBone />
          <ListingCardBone />
        </div>
      ) : q.data.length === 0 ? (
        <p className="text-sm text-muted-foreground">No homes for rent match yet. Try another city or fewer filters.</p>
      ) : (
        <div className={GRID}>
          {q.data.map((l) => (
            <ListingCard key={l.id} l={l} />
          ))}
        </div>
      )}
    </RentalsCard>
  );
}
