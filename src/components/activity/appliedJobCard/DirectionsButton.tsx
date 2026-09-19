import { Navigation } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  JOB_ACTION_CHIP_CLASS,
  JOB_ROW_LABEL_CLASS,
  jobActionChipStyle,
} from "@/components/activity/JobActionRow";
import { mapsSearchUrl } from "@/lib/mapsLink";

/**
 * "Directions" — the one control a helpr who is about to set off actually needs.
 *
 * The affordance already existed, but only as the LOCATION TEXT in the card's
 * meta row: an 11px city name with a pin next to it, which reads as a label,
 * not a button. Nobody discovers a navigation launcher hiding inside a
 * truncated "Delc…". Now that arrival requires real GPS proximity, getting
 * there is on the critical path, so the move deserves a real button.
 *
 * The URL comes from {@link mapsSearchUrl} and nowhere else — that helper
 * carries the deliberate privacy decision (send the ADDRESS, never the
 * coordinates of somebody's front door) and the per-platform provider choice
 * (`maps://` on iOS, `geo:` on Android, Google Maps on web). Building a URL
 * here would quietly undo both.
 *
 * Rendered as an <a> through Button's `asChild`, matching JobCardMetaRow: an
 * anchor hands the scheme straight to the OS, where `window.open` on a
 * `maps://` URL inside a WebView is the shape that gets swallowed.
 *
 * Returns null when there is no address — a Directions button that navigates
 * nowhere is worse than no button.
 */
export function DirectionsButton({ location }: { location: string | null | undefined }) {
  const href = location ? mapsSearchUrl(location) : "";
  if (!href) return null;

  /*
   * ONE SHAPE, and it is the row's (owner, 2026-09-19, second report).
   *
   * There used to be a `variant` prop here: `"chip"` (the row control) and
   * `"full"`, a full-width horizontal control carrying `JOB_ACTION_FULL_CLASS`
   * — a THIRD button tier that existed only in this file. Both live call sites
   * (EnRouteStep, ConfirmedSection) passed `"chip"`; `"full"` was the DEFAULT,
   * so nothing rendered it and nothing could, yet it was the shape a reader of
   * this file would assume was normal. The tier and the prop are gone rather
   * than preserved behind a flag: a row control that can be drawn two ways is
   * how a row ends up with two kinds of object in it.
   *
   * It draws its own <Button> (rather than going through JobActionChip)
   * because it owns an <a> — an anchor hands a `maps://` scheme straight to
   * the OS, where `window.open` inside a WebView swallows it — so it takes the
   * shared class and the shared label class instead.
   */
  return (
    <Button
      asChild
      size="sm"
      variant="outline"
      className={JOB_ACTION_CHIP_CLASS}
      // `neutral`, not `primary`: Directions is navigational, a thing you do on
      // the way to the decision — it must not out-shout "Mark Job Complete".
      // Same olivewood tint Message wears, which is the tone this row speaks in.
      style={jobActionChipStyle("neutral")}
    >
      <a
        href={href}
        target="_blank"
        rel="noopener noreferrer"
        // The card shell owns expand/collapse. Without this the tap opens
        // Maps AND toggles the card underneath, so the helpr comes back from
        // navigation to a card in a different state than they left it. Same
        // guard the location link in JobCardMetaRow uses.
        onClick={(e) => e.stopPropagation()}
        aria-label={`Directions — get directions to ${location}`}
      >
        <Navigation className="w-4 h-4" />
        <span className={JOB_ROW_LABEL_CLASS}>Directions</span>
      </a>
    </Button>
  );
}
