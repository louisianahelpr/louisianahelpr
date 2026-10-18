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
import { RentalsCard } from "../rentalsUi";

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
      className="flex gap-3 rounded-xl border border-border p-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      {cover ? (
        <img src={listingPhotoUrl(cover)} alt="" className="h-20 w-24 shrink-0 rounded-lg object-cover" loading="lazy" />
      ) : (
        <span className="h-20 w-24 shrink-0 rounded-lg bg-muted" aria-hidden />
      )}
      <span className="min-w-0 flex-1">
        <span className="block font-semibold text-sm">{rentLine(l.rent_cents, l.rent_frequency)}</span>
        <span className="block text-sm truncate" title={l.headline}>{l.headline}</span>
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
        <Input aria-label="City or ZIP" placeholder="City or ZIP" value={place} onChange={(e) => setPlace(e.target.value)} />
        <div className="flex gap-2">
          <select
            aria-label="Bedrooms"
            className="h-11 flex-1 min-w-0 rounded-md border border-input bg-background px-3 text-sm"
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
        <Button type="submit" size="sm" variant="outline">
          Search
        </Button>
      </form>
      {q.isError ? (
        <ErrorState onRetry={() => q.refetch()} />
      ) : !q.data ? (
        <div role="status" aria-label="Loading homes for rent" className="space-y-2">
          <Skeleton className="h-24 w-full rounded-xl" aria-hidden />
          <Skeleton className="h-24 w-full rounded-xl" aria-hidden />
        </div>
      ) : q.data.length === 0 ? (
        <p className="text-sm text-muted-foreground">No homes for rent match yet. Try another city or fewer filters.</p>
      ) : (
        <div className="space-y-2">
          {q.data.map((l) => (
            <ListingCard key={l.id} l={l} />
          ))}
        </div>
      )}
    </RentalsCard>
  );
}
