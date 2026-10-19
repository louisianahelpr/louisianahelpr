import { Bell, CheckCircle2 } from "lucide-react";
import { EmptyState } from "@/components/ui/EmptyState";
import { Button } from "@/components/ui/button";

/**
 * THE END OF A BROWSE LIST (owner, 2026-10-19): when a Browse list runs out,
 * short lists included, it ends on a friendly card in the shared empty-state
 * style instead of just stopping. One component for Jobs, Declutter, Shops and
 * Homes, so the four read the same.
 *
 * It never promises what we don't do (lead, 2026-10-19): "Widen distance" only
 * where the section HAS a distance filter and it is not already at its widest,
 * and "Turn on alerts" only where a real alert exists (Jobs: the job alerts the
 * empty feed's "Notify me" turns on). With no widen action the card says
 * "That's everything for now. Check back soon." Guard:
 * src/test/browseEndCard.test.tsx.
 */
export function BrowseEndCard({
  onWiden,
  widenLabel = "Widen distance",
  onAlerts,
}: {
  /** Omit where there is no distance filter, or it is already "Any distance". */
  onWiden?: () => void;
  widenLabel?: string;
  /** Omit where the section has no alert to turn on. */
  onAlerts?: () => void;
}) {
  const body = onWiden
    ? onAlerts
      ? "Widen your distance or turn on alerts."
      : "Widen your distance to see more."
    : onAlerts
      ? "Check back soon, or turn on alerts."
      : "Check back soon.";
  return (
    <div data-testid="browse-end-card" className="pt-2 pb-4">
      <EmptyState
        // Bare, like every Browse's empty state (owner, 2026-10-19: one style, Homes').
        variant="bare"
        icon={CheckCircle2}
        title={onWiden ? "That's everything nearby." : "That's everything for now."}
        body={body}
        action={
          onWiden || onAlerts ? (
            <div className="flex flex-wrap items-center justify-center gap-2">
              {onWiden && (
                <Button type="button" size="sm" onClick={onWiden} className="rounded-full">
                  {widenLabel}
                </Button>
              )}
              {onAlerts && (
                <Button type="button" size="sm" variant="outline" onClick={onAlerts} className="rounded-full">
                  <Bell className="w-4 h-4 mr-1" strokeWidth={2.25} aria-hidden />
                  Turn on alerts
                </Button>
              )}
            </div>
          ) : undefined
        }
      />
    </div>
  );
}
