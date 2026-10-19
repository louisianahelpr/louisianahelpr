import { useEffect, useRef, useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { Home } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { LISTING_GRID, ListingCardBone } from "./listingBones";
import { ErrorState } from "@/components/ui/ErrorState";
import { EmptyState } from "@/components/ui/EmptyState";
import { FilterSheet } from "@/components/dashboard/FilterSheet";
import { chipStyles } from "@/components/dashboard/JobFilters";
import { hapticLight } from "@/lib/haptics";
import { fetchBrowseListings, fetchBrowseSaleListings, listingPhotoUrl } from "@/lib/rentals/listings";
import { useRefreshOnExpiredRef } from "./useRefreshOnExpiredRef";
import { availableLine, bedsBathsLine, priceLine, rentLine } from "@/lib/rentals/listingCopy";
import { dollarsToCents } from "@/lib/rentals/copy";
import { BrowseEndCard } from "@/components/sections/BrowseEndCard";
import { SectionSearchRow } from "@/components/sections/SectionSearchRow";

/**
 * Homes -> Rent: homes for rent (RL1a). Live listings, filtered by FACTS about
 * the home only (place, bedrooms, rent): never a filter about who may live
 * there (fair housing, spec 6a). The card shows the city and ZIP, never the
 * street (Q12).
 *
 * Layout (owner bar, 2026-10-19: Zillow/Airbnb): ONE slim search row (City or
 * ZIP, the filter button inside it) with bedrooms and rent in the shared
 * filter sheet, then photo-first cards with no outline. No card around the
 * list: a box inside a box is the look the lead sent back.
 *
 * Homes -> Buy (20261019061241) is the same screen over homes for sale: the
 * price instead of rent, no move-in date, a most-price filter.
 */
interface CardRow {
  id: string;
  headline: string;
  beds: number;
  baths: number;
  city: string;
  zip_code: string;
  photo_refs: string[];
  is_mine: boolean;
  /** The big line: rent per period, or the sale price. */
  price: string;
  /** The last line: the move-in date (rent), nothing (sale). */
  when: string | null;
}

function ListingCard({ l }: { l: CardRow }) {
  const cover = l.photo_refs?.[0];
  const refresh = useRefreshOnExpiredRef([["rentals-browse"], ["rentals-browse-sale"]]);
  return (
    <Link
      to={`/rentals/listings/${l.id}`}
      className="group block rounded-2xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      <span className="relative block overflow-hidden rounded-2xl bg-muted">
        {cover ? (
          <img src={listingPhotoUrl(cover)} alt="" onError={() => refresh(cover)} className="aspect-[16/10] w-full object-cover ctl-tint" loading="lazy" />
        ) : (
          <span className="flex aspect-[16/10] w-full items-center justify-center text-muted-foreground" aria-hidden>
            <Home className="h-8 w-8" />
          </span>
        )}
        {l.is_mine && (
          <span className="absolute left-2 top-2 rounded-full bg-card px-2.5 py-1 text-ds-12 font-semibold shadow-sm">Your listing</span>
        )}
      </span>
      <span className="block space-y-0.5 px-1 pt-2.5">
        <span className="block text-ds-17 font-bold">{l.price}</span>
        <span className="block line-clamp-2 text-ds-15" title={l.headline}>
          {l.headline}
        </span>
        <span className="block text-ds-14 text-muted-foreground">
          {bedsBathsLine(l.beds, l.baths)} · {l.city} {l.zip_code}
        </span>
        {l.when && <span className="block text-ds-14 text-muted-foreground">{l.when}</span>}
      </span>
    </Link>
  );
}

const BEDS = [
  { value: null, label: "Any" },
  { value: 1, label: "1+" },
  { value: 2, label: "2+" },
  { value: 3, label: "3+" },
  { value: 4, label: "4+" },
] as const;

/** Typing settles for this long before the search runs (no Search button). */
const SEARCH_SETTLE_MS = 350;

/** What differs between Rent and Buy; everything else is one screen. */
interface BrowseKind {
  key: "rent" | "sale";
  noun: string;
  priceFilterTitle: string;
  priceFilterLabel: string;
  fetch: (f: { city: string; minBeds: number | null; maxCents: number | null }) => Promise<CardRow[]>;
}

const RENT: BrowseKind = {
  key: "rent",
  noun: "homes for rent",
  priceFilterTitle: "Most rent per month",
  priceFilterLabel: "Most rent per month, in dollars",
  fetch: async ({ city, minBeds, maxCents }) =>
    (await fetchBrowseListings({ city, minBeds, maxRentCents: maxCents })).map((l) => ({
      ...l,
      price: rentLine(l.rent_cents, l.rent_frequency),
      when: availableLine(l.available_on),
    })),
};

const SALE: BrowseKind = {
  key: "sale",
  noun: "homes for sale",
  priceFilterTitle: "Most price",
  priceFilterLabel: "Most price, in dollars",
  fetch: async ({ city, minBeds, maxCents }) =>
    (await fetchBrowseSaleListings({ city, minBeds, maxPriceCents: maxCents })).map((l) => ({
      ...l,
      price: priceLine(l.sale_price_cents),
      when: null,
    })),
};

/** Rent (default) or Buy, chosen in the filter sheet (owner, 2026-10-19). */
export type HomesKind = "rent" | "buy";

const KINDS: { value: HomesKind; label: string }[] = [
  { value: "rent", label: "Rent" },
  { value: "buy", label: "Buy" },
];

/**
 * Homes > Browse: one screen for Rent and Buy. Rent or Buy is the FIRST choice
 * in the filter sheet (owner, 2026-10-19: the Rent | Buy pill row under the
 * toggle went away, so Homes has exactly the rows every section has). While
 * Buy is on, the search row says so ("Homes for sale: City or ZIP") and the
 * filter button counts it. `intro` is Buy's verified-owners line.
 */
export function HomesListings({ homes, onKind, intro }: { homes: HomesKind; onKind: (k: HomesKind) => void; intro?: ReactNode }) {
  return <ListingsBrowse key={homes} kind={homes === "buy" ? SALE : RENT} onKind={onKind} intro={intro} />;
}

function ListingsBrowse({ kind, onKind, intro }: { kind: BrowseKind; onKind: (k: HomesKind) => void; intro?: ReactNode }) {
  const buy = kind.key === "sale";
  const [place, setPlace] = useState("");
  const [city, setCity] = useState("");
  const [minBeds, setMinBeds] = useState<number | null>(null);
  const [maxRent, setMaxRent] = useState("");
  const [filtersOpen, setFiltersOpen] = useState(false);
  const filtersButtonRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    const t = setTimeout(() => setCity(place.trim()), SEARCH_SETTLE_MS);
    return () => clearTimeout(t);
  }, [place]);
  const maxCents = maxRent.trim() ? dollarsToCents(maxRent) : null;
  const applied = { city, minBeds, maxCents };
  const q = useQuery({
    queryKey: [kind.key === "rent" ? "rentals-browse" : "rentals-browse-sale", applied],
    queryFn: () => kind.fetch(applied),
  });
  // Buy counts as a filter, so the button wears its badge while it is on.
  const activeFilters = (buy ? 1 : 0) + (minBeds != null ? 1 : 0) + (maxCents != null ? 1 : 0);
  const clearFilters = () => {
    setMinBeds(null);
    setMaxRent("");
    if (buy) onKind("rent");
  };
  return (
    <section aria-label={kind.key === "rent" ? "Homes for rent" : "Homes for sale"} className="space-y-4">
      <SectionSearchRow
        searchLabel={`Search ${kind.noun}`}
        value={place}
        onChange={setPlace}
        onSubmit={() => setCity(place.trim())}
        placeholder={buy ? "Homes for sale: City or ZIP" : "City or ZIP"}
        filterCount={activeFilters}
        filtersOpen={filtersOpen}
        onFilters={() => setFiltersOpen(!filtersOpen)}
        filtersButtonRef={filtersButtonRef}
      />
      {intro}
      <FilterSheet
        open={filtersOpen}
        onOpenChange={setFiltersOpen}
        anchorRef={filtersButtonRef}
        activeFilterCount={activeFilters}
        onClearAll={clearFilters}
        sections={[
          {
            key: "kind",
            title: "Homes to",
            content: (
              <div role="group" aria-label="Rent or buy" className={chipStyles.chipRow}>
                {KINDS.map((k) => (
                  <button
                    key={k.value}
                    type="button"
                    aria-pressed={(buy ? "buy" : "rent") === k.value}
                    onClick={() => {
                      hapticLight();
                      onKind(k.value);
                    }}
                    className={`${chipStyles.chipBase} ${(buy ? "buy" : "rent") === k.value ? chipStyles.chipActive : chipStyles.chipIdle}`}
                  >
                    {k.label}
                  </button>
                ))}
              </div>
            ),
          },
          {
            key: "beds",
            title: "Bedrooms",
            content: (
              <div role="group" aria-label="Bedrooms" className={chipStyles.chipRow}>
                {BEDS.map((b) => (
                  <button
                    key={b.label}
                    type="button"
                    aria-pressed={minBeds === b.value}
                    onClick={() => {
                      hapticLight();
                      setMinBeds(b.value);
                    }}
                    className={`${chipStyles.chipBase} ${minBeds === b.value ? chipStyles.chipActive : chipStyles.chipIdle}`}
                  >
                    {b.label}
                  </button>
                ))}
              </div>
            ),
          },
          {
            key: "rent",
            title: kind.priceFilterTitle,
            content: (
              <Input
                aria-label={kind.priceFilterLabel}
                placeholder="Any amount"
                inputMode="decimal"
                value={maxRent}
                onChange={(e) => setMaxRent(e.target.value)}
              />
            ),
          },
        ]}
      />
      {q.isError ? (
        <ErrorState onRetry={() => q.refetch()} />
      ) : !q.data ? (
        <div role="status" aria-label={`Loading ${kind.noun}`} className={LISTING_GRID}>
          <ListingCardBone />
          <ListingCardBone />
        </div>
      ) : q.data.length === 0 ? (
        <EmptyState
          variant="bare"
          icon={Home}
          title={`No ${kind.noun} here yet`}
          body={
            city || activeFilters
              ? `No ${kind.noun} match yet. Try another city or fewer filters.`
              : `No ${kind.noun} match yet. New homes show up here as owners list them.`
          }
          action={
            activeFilters > 0 ? (
              <Button type="button" variant="outline" size="sm" onClick={clearFilters}>
                Clear filters
              </Button>
            ) : undefined
          }
        />
      ) : (
        <div className={LISTING_GRID}>
          {q.data.map((l) => (
            <ListingCard key={l.id} l={l} />
          ))}
        </div>
      )}
      {/* No distance filter in Homes and no listing alerts yet: just the friendly end. */}
      {!q.isError && q.data && q.data.length > 0 && <BrowseEndCard />}
    </section>
  );
}
