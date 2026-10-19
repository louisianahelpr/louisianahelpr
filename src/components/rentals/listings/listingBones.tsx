import { Skeleton } from "@/components/ui/skeleton";

/**
 * The Rent listing grid and its loading bone, shared by RentBrowse and the
 * Homes page skeleton (RentalsSkeletons.tsx) so nothing moves when the list
 * arrives. Kept apart from RentBrowse so the skeleton does not pull in the
 * filter sheet.
 */
export const LISTING_GRID = "grid gap-x-4 gap-y-6 sm:grid-cols-2 xl:grid-cols-3";

export function ListingCardBone() {
  return (
    <div aria-hidden>
      <Skeleton className="aspect-[4/3] w-full rounded-2xl" />
      <div className="space-y-1.5 px-1 pt-2.5">
        <Skeleton className="h-5 w-28" />
        <Skeleton className="h-4 w-3/4" />
        <Skeleton className="h-4 w-1/2" />
        <Skeleton className="h-4 w-1/3" />
      </div>
    </div>
  );
}
