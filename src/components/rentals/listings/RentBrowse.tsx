import { useEffect, useRef, useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Heart, Home } from "lucide-react";
import { toast } from "sonner";
import { userFacingError } from "@/lib/userFacingError";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { LISTING_GRID, ListingCardBone } from "./listingBones";
import { ErrorState } from "@/components/ui/ErrorState";
import { BrowseEmptyState } from "@/components/ui/BrowseEmptyState";
import { FilterSheet } from "@/components/dashboard/FilterSheet";
import { chipStyles } from "@/components/dashboard/JobFilters";
import { hapticLight } from "@/lib/haptics";
import { fetchBrowseListings, fetchBrowseSaleListings, listingPhotoUrl } from "@/lib/rentals/listings";
import { useRefreshOnExpiredRef } from "./useRefreshOnExpiredRef";
import { availableLine, factsLine, priceLine, rentLine } from "@/lib/rentals/listingCopy";
import { fetchSavedHomeIds, setSavedHome } from "@/lib/rentals/savedHomes";
import { PhotoPlaceholder } from "@/components/ui/PhotoPlaceholder";
import { dollarsToCents } from "@/lib/rentals/copy";
import { BrowseEndCard } from "@/components/sections/BrowseEndCard";
import { SectionSearchRow } from "@/components/sections/SectionSearchRow";
import { useSectionPreview } from "@/components/sections/ExploreSwitcher";

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
export interface CardRow {
  id: string;
  headline: string;
  beds: number;
  baths: number;
  sq_ft: number | null;
  city: string;
  zip_code: string;
  photo_refs: string[];
  is_mine: boolean;
  /** The big line: rent per period, or the sale price. */
  price: string;
  /** The last line: the move-in date (rent), nothing (sale). */
  when: string | null;
}

/**
 * A Homes card (owner-approved design, 2026-10-19 14:55Z: Zillow / Airbnb): a
 * big photo (or the house icon on a soft tint: PhotoPlaceholder), the price
 * per month or the sale price, beds · baths · square feet, the place (city and
 * ZIP, never the street: Q12), and a heart to save it (not on your own
 * listing). The heart sits beside the link, never inside it.
 */
export function ListingCard({ l, kind, saved, onSave }: { l: CardRow; kind: "rent" | "sale"; saved?: boolean; onSave?: (saved: boolean) => void }) {
  const cover = l.photo_refs?.[0];
  const refresh = useRefreshOnExpiredRef([["rentals-browse"], ["rentals-browse-sale"], ["rentals-saved"]]);
  return (
    <div className="relative min-w-0" data-home-card="">
      <Link
        to={`/rentals/listings/${l.id}`}
        // The headline is not on the card (owner design: price, facts, place); it still names the link.
        aria-label={`${l.headline}: ${l.price}, ${factsLine(l.beds, l.baths, l.sq_ft)}, ${l.city} ${l.zip_code}${l.when ? `, ${l.when}` : ""}`}
        className="group block rounded-2xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <span className="relative block aspect-[4/3] overflow-hidden rounded-2xl bg-muted">
          {cover ? (
            <img src={listingPhotoUrl(cover)} alt="" onError={() => refresh(cover)} className="h-full w-full object-cover ctl-tint" loading="lazy" />
          ) : (
            <PhotoPlaceholder icon={Home} seed={kind} className="h-full w-full" />
          )}
          {l.is_mine && (
            <span className="absolute left-2 top-2 rounded-full bg-card px-2.5 py-1 text-ds-12 font-semibold shadow-sm">Your listing</span>
          )}
        </span>
        <span className="block min-w-0 space-y-0.5 px-0.5 pt-2.5">
          <span data-card-price className="block text-ds-17 font-bold tabular-nums">{l.price}</span>
          <span data-card-facts className="block truncate text-ds-14" title={factsLine(l.beds, l.baths, l.sq_ft)}>
            {factsLine(l.beds, l.baths, l.sq_ft)}
          </span>
          <span data-card-place className="block truncate text-ds-14 text-muted-foreground" title={`${l.city} ${l.zip_code}`}>
            {l.city} {l.zip_code}
          </span>
          {/* Its own line: beside the place it was cut at 320 ("Available Nov 1, ..."). */}
          {l.when && <span className="block truncate text-ds-14 text-muted-foreground">{l.when}</span>}
        </span>
      </Link>
      {onSave && !l.is_mine && <SaveHomeButton saved={!!saved} onSave={onSave} />}
    </div>
  );
}

/** The heart over a card's photo: 44px to tap, a 36px circle to see. */
function SaveHomeButton({ saved, onSave }: { saved: boolean; onSave: (saved: boolean) => void }) {
  return (
    <button
      type="button"
      data-save-home=""
      aria-pressed={saved}
      aria-label={saved ? "Saved. Tap to remove from Saved homes" : "Save this home"}
      onClick={() => {
        hapticLight();
        onSave(!saved);
      }}
      className="absolute right-1 top-1 flex h-11 w-11 items-center justify-center rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      <span className="flex h-9 w-9 items-center justify-center rounded-full bg-card/90 shadow-sm">
        <Heart
          className={`h-[18px] w-[18px] ${saved ? "text-[hsl(var(--accent-ink))]" : "text-foreground"}`}
          fill={saved ? "currentColor" : "none"}
          aria-hidden
        />
      </span>
    </button>
  );
}

/**
 * The member's saved homes and the save / unsave write, shared by Browse and
 * the Saved list. The heart flips at once and goes back (with the reason) if
 * the server refuses.
 */
export function useSavedHomes() {
  const qc = useQueryClient();
  const ids = useQuery({ queryKey: ["rentals-saved-ids"], queryFn: fetchSavedHomeIds });
  const save = useMutation({
    mutationFn: ({ id, saved }: { id: string; saved: boolean }) => setSavedHome(id, saved),
    onMutate: ({ id, saved }) => {
      const before = qc.getQueryData<Set<string>>(["rentals-saved-ids"]);
      const next = new Set(before ?? []);
      if (saved) next.add(id);
      else next.delete(id);
      qc.setQueryData(["rentals-saved-ids"], next);
      return { before };
    },
    onError: (e, _v, ctx) => {
      qc.setQueryData(["rentals-saved-ids"], ctx?.before);
      toast.error(userFacingError(e, "Couldn't save that home. Try again."));
    },
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: ["rentals-saved-ids"] });
      void qc.invalidateQueries({ queryKey: ["rentals-saved"] });
    },
  });
  return {
    ids,
    isSaved: (id: string) => ids.data?.has(id) ?? false,
    setSaved: (id: string, saved: boolean) => save.mutate({ id, saved }),
  };
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
const HOME_NOUN = ["home", "homes"] as const;

export function HomesListings({ homes, onKind, intro }: { homes: HomesKind; onKind: (k: HomesKind) => void; intro?: ReactNode }) {
  return <ListingsBrowse key={homes} kind={homes === "buy" ? SALE : RENT} onKind={onKind} intro={intro} />;
}

function ListingsBrowse({ kind, onKind, intro }: { kind: BrowseKind; onKind: (k: HomesKind) => void; intro?: ReactNode }) {
  const buy = kind.key === "sale";
  // A tester inside Homes before it opens to everyone: no homes yet "Opens soon" (owner, 2026-10-22).
  const preview = useSectionPreview("homes");
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
  // The hearts load with the list (one paint); a failed read shows empty hearts, never blocks Browse.
  const saved = useSavedHomes();
  const listReady = !!q.data && !saved.ids.isLoading;
  // The filters that NARROW the list (bedrooms, price): what the empty state's words and its
  // Clear filters button are about. Buy is a choice of list, not a narrowing.
  const narrowing = (minBeds != null ? 1 : 0) + (maxCents != null ? 1 : 0);
  // Buy counts on the filter button, so it wears its badge while Buy is on.
  const activeFilters = (buy ? 1 : 0) + narrowing;
  const clearFilters = () => {
    setMinBeds(null);
    setMaxRent("");
    if (buy) onKind("rent");
  };
  return (
    <section aria-label={kind.key === "rent" ? "Homes for rent" : "Homes for sale"} className="flex min-h-0 flex-1 flex-col gap-4">
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
      {(saved.ids.data?.size ?? 0) > 0 && (
        <Link
          to="/rentals?view=saved"
          data-testid="saved-homes-link"
          className="inline-flex min-h-11 items-center gap-2 self-start px-1 text-ds-14 font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded-full"
        >
          <Heart className="h-4 w-4 text-[hsl(var(--accent-ink))]" fill="currentColor" aria-hidden />
          Saved homes
          <span className="text-muted-foreground">{saved.ids.data?.size}</span>
        </Link>
      )}
      <FilterSheet
        open={filtersOpen}
        onOpenChange={setFiltersOpen}
        anchorRef={filtersButtonRef}
        title="Filter homes"
        resultNoun={HOME_NOUN}
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
      ) : !listReady || !q.data ? (
        <div role="status" aria-label={`Loading ${kind.noun}`} className={LISTING_GRID}>
          <ListingCardBone />
          <ListingCardBone />
        </div>
      ) : q.data.length === 0 ? (
        // Owner 11-01 (B107): the shared Browse empty state, in the same spot as Shops, Declutter and Jobs.
        <BrowseEmptyState
          icon={Home}
          title={preview ? "Opens soon" : `No ${kind.noun} here yet`}
          body={
            city || narrowing
              ? `No ${kind.noun} match yet. Try another city or fewer filters.`
              : `No ${kind.noun} match yet. New homes show up here as owners list them.`
          }
          action={
            narrowing > 0 ? (
              <Button type="button" variant="outline" size="sm" onClick={() => { setMinBeds(null); setMaxRent(""); }}>
                Clear filters
              </Button>
            ) : undefined
          }
        />
      ) : (
        <div className={LISTING_GRID}>
          {q.data.map((l) => (
            <ListingCard key={l.id} l={l} kind={kind.key} saved={saved.isSaved(l.id)} onSave={(v) => saved.setSaved(l.id, v)} />
          ))}
        </div>
      )}
      {/* No distance filter in Homes and no listing alerts yet: just the friendly end. */}
      {!q.isError && q.data && q.data.length > 0 && <BrowseEndCard />}
    </section>
  );
}
