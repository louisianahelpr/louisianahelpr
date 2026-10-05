import { Button } from "@/components/ui/button";

/**
 * The guest /browse empty state's way forward (moved out of DashboardGuest,
 * Q1312, to keep that page under its component-size ratchet; markup and
 * copy unchanged).
 *
 * Filtered: widen the radius / show all locations, or clear the filters.
 * Unfiltered: "Notify Me When Work Lands" and "Or Hire Someone for a Job".
 */
export function GuestEmptyStateActions({
  hasFilters,
  nearbyActive,
  nextMiles,
  onWiden,
  onShowAllLocations,
  onClearFilters,
  onNotify,
  onHire,
}: {
  hasFilters: boolean;
  nearbyActive: boolean;
  nextMiles: number;
  onWiden: () => void;
  onShowAllLocations: () => void;
  onClearFilters: () => void;
  onNotify: () => void;
  onHire: () => void;
}) {
  if (hasFilters) {
    return nearbyActive ? (
      <div className="flex flex-col items-center gap-2 sm:flex-row sm:gap-3">
        <button
          type="button"
          onClick={onWiden}
          className="text-ds-11 font-semibold text-primary hover:underline btn-press"
        >
          Widen to {nextMiles} mi
        </button>
        <button
          type="button"
          onClick={onShowAllLocations}
          className="text-ds-11 font-semibold text-muted-foreground hover:underline btn-press"
        >
          Show All Locations
        </button>
      </div>
    ) : (
      <button
        type="button"
        onClick={onClearFilters}
        className="text-ds-11 font-semibold text-primary hover:underline btn-press"
      >
        Clear Filters
      </button>
    );
  }
  /* Unfiltered empty state used to pass NO action, so a visitor who landed on
     Browse before any jobs were posted read "check back soon" and had nowhere
     to go — a dead end at the exact moment they were most curious. The
     signed-in version of this same state offers two ways forward; the guest
     one offered none. They are named for what the visitor wants rather than
     for the gate: watching for work, or hiring someone. */
  return (
    <div className="flex flex-col items-center gap-2.5">
      {/* `outline`, not the filled primary. This is an EMPTY state — there is
          nothing here to act on, so a full-weight green CTA slab was shouting
          about an absence. The outline keeps the way forward available without
          making "no jobs today" look like the most important thing on the
          screen. */}
      {/* size="sm" is the 44px (h-11) height this button always had; px-5 and
          text-ds-16 keep its old width and type (it used to hand-set h-11). */}
      <Button
        variant="outline"
        size="sm"
        onClick={onNotify}
        className="rounded-ds-md px-5 text-ds-16 font-semibold"
      >
        Notify Me When Work Lands
      </Button>
      <button
        type="button"
        onClick={onHire}
        className="text-ds-11 font-semibold text-muted-foreground hover:underline btn-press"
      >
        Or Hire Someone for a Job
      </button>
    </div>
  );
}
