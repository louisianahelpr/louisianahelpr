import type { ReactNode } from "react";
import { Bell } from "lucide-react";
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
 *
 * Owner 2026-11-17 (signed-in tweaks, item 3): the card's round check-mark disc, alone under the last job, read as a
 * stray button. The end is now plain text (a small line and its body), with no icon; the actions stay.
 */
export function BrowseEndCard({
  onWiden,
  widenLabel = "Widen distance",
  onAlerts,
  footnote,
  title,
}: {
  /** The section's own end line (Jobs: "That's every open job near you."); else the shared wording. */
  title?: string;
  /** Omit where there is no distance filter, or it is already "Any distance". */
  onWiden?: () => void;
  widenLabel?: string;
  /** Omit where the section has no alert to turn on. */
  onAlerts?: () => void;
  /** A quiet line under the card's actions, inside the card (Declutter's "Can't find it?" link, owner 2026-10-28). */
  footnote?: ReactNode;
}) {
  const body = onWiden
    ? onAlerts
      ? "Widen your distance or turn on alerts."
      : "Widen your distance to see more."
    : onAlerts
      ? "Check back soon, or turn on alerts."
      : "Check back soon.";
  return (
    <div data-testid="browse-end-card" className="flex flex-col items-center gap-1 px-4 pt-4 pb-6 text-center">
      <p className="text-ds-14 font-semibold text-foreground">{title ?? (onWiden ? "That's everything nearby." : "That's everything for now.")}</p>
      <p className="text-ds-13 text-muted-foreground">{body}</p>
      {(onWiden || onAlerts) && (
        <div className="mt-2 flex flex-wrap items-center justify-center gap-2">
          {onWiden && (
            <Button type="button" size="sm" onClick={onWiden} className="rounded-full">
              {widenLabel}
            </Button>
          )}
          {onAlerts && (
            <Button type="button" size="sm" variant="outline" onClick={onAlerts} className="rounded-full">
              <Bell className="w-4 h-4 mr-1" aria-hidden />
              Turn on alerts
            </Button>
          )}
        </div>
      )}
      {footnote && <div className="mt-2 text-ds-13 text-muted-foreground">{footnote}</div>}
    </div>
  );
}
