import { Button } from "@/components/ui/button";
import { hapticLight } from "@/lib/haptics";

/**
 * Board 24's sticky footer: "Clear all" as an olive text link on the left
 * (never the old rust-tinted button: rust is money only) and the ONE primary
 * button on the right, which closes the panel onto the results.
 *
 * TRUTH RULE (lead, board 24): the button prints a number only when the
 * caller hands it an exact count for the whole filtered set. Anything else
 * (`null`/`undefined`: more pages still to load, the list still loading)
 * reads "Show jobs" with no number. Zero reads "No jobs match", not "Show 0".
 */
function filterResultsLabel(
  resultCount: number | null | undefined,
  [one, many]: readonly [string, string],
): string {
  if (resultCount === null || resultCount === undefined) return `Show ${many}`;
  if (resultCount === 0) return `No ${many} match`;
  return `Show ${resultCount} ${resultCount === 1 ? one : many}`;
}

export function FilterSheetFooter({
  activeFilterCount,
  onClearAll,
  onDone,
  resultCount,
  resultNoun,
}: {
  activeFilterCount: number;
  onClearAll?: () => void;
  onDone: () => void;
  resultCount?: number | null;
  resultNoun: readonly [string, string];
}) {
  return (
    <div
      data-testid="filter-sheet-footer"
      className="sticky bottom-0 z-10 shrink-0 flex items-center justify-between gap-4 px-5 pt-3 pb-[max(0.75rem,var(--safe-area-bottom,0px))] border-t border-[hsl(var(--bark)/0.12)] bg-premium-page"
    >
      {onClearAll ? (
        <button
          type="button"
          disabled={activeFilterCount === 0}
          onClick={() => {
            hapticLight();
            onClearAll();
          }}
          className="min-h-11 px-1 text-ds-14 font-bold btn-press disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded-ds-md"
          style={{ color: "hsl(var(--bark))" }}
        >
          Clear all
        </button>
      ) : (
        <span />
      )}
      <Button
        type="button"
        variant="primary"
        className="flex-1 max-w-xs"
        aria-live="polite"
        onClick={() => {
          hapticLight();
          onDone();
        }}
      >
        {filterResultsLabel(resultCount, resultNoun)}
      </Button>
    </div>
  );
}
