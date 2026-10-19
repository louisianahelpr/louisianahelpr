import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { ChevronLeft, Heart } from "lucide-react";
import { ErrorState } from "@/components/ui/ErrorState";
import { EmptyState } from "@/components/ui/EmptyState";
import { OfflineEmptyState } from "@/components/ui/OfflineEmptyState";
import { useFeedPhase } from "@/hooks/useFeedPhase";
import { fetchSavedListings, type SavedListing } from "@/lib/rentals/savedHomes";
import { availableLine, priceLine, rentLine } from "@/lib/rentals/listingCopy";
import { LISTING_GRID, ListingCardBone } from "./listingBones";
import { ListingCard, useSavedHomes, type CardRow } from "./RentBrowse";

/**
 * Homes -> Saved homes (/rentals?view=saved): every home the member saved
 * with the heart, rent and sale together, newest saved first, on the same
 * card as Browse. A home that is no longer listed drops out (and comes back
 * if it is listed again). Unsaving here takes it off the list.
 */
function toCard(l: SavedListing): CardRow & { kind: "rent" | "sale" } {
  const sale = l.kind === "sale";
  return {
    id: l.id,
    headline: l.headline,
    beds: l.beds,
    baths: l.baths,
    sq_ft: l.sq_ft,
    city: l.city,
    zip_code: l.zip_code,
    photo_refs: l.photo_refs,
    is_mine: false,
    kind: sale ? "sale" : "rent",
    price: sale ? priceLine(l.sale_price_cents) : rentLine(l.rent_cents, l.rent_frequency),
    when: sale || !l.available_on ? null : availableLine(l.available_on),
  };
}

export function SavedHomes() {
  const list = useQuery({ queryKey: ["rentals-saved"], queryFn: fetchSavedListings });
  const saved = useSavedHomes();
  // Offline with nothing loaded is never "No saved homes yet" (Q571).
  const phase = useFeedPhase(list);
  const rows = (list.data ?? []).map(toCard);
  return (
    <section aria-label="Saved homes" className="space-y-4">
      <Link
        to="/rentals"
        className="inline-flex min-h-11 items-center gap-1 self-start rounded-full px-1 text-ds-14 font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <ChevronLeft className="h-4 w-4" aria-hidden />
        All homes
      </Link>
      <h2 className="px-1 text-ds-13 font-bold uppercase tracking-[0.06em] text-muted-foreground">
        Saved homes
        {list.data && <span className="ml-1.5 text-foreground/70">{rows.length}</span>}
      </h2>
      {list.isError ? (
        <ErrorState onRetry={() => list.refetch()} />
      ) : !list.data || saved.ids.isLoading ? (
        <div role="status" aria-label="Loading saved homes" className={LISTING_GRID}>
          <ListingCardBone />
          <ListingCardBone />
        </div>
      ) : phase === "offline-empty" ? (
        <OfflineEmptyState body="Your saved homes will show here once you're back online." onRetry={() => void list.refetch()} />
      ) : rows.length === 0 ? (
        <EmptyState variant="bare" icon={Heart} title="No saved homes yet." body="Tap the heart on a home to keep it here." />
      ) : (
        <div className={LISTING_GRID}>
          {rows.map((l) => (
            <ListingCard key={l.id} l={l} kind={l.kind} saved={saved.isSaved(l.id)} onSave={(v) => saved.setSaved(l.id, v)} />
          ))}
        </div>
      )}
    </section>
  );
}
