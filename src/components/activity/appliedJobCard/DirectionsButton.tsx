import { Navigation } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  JOB_ACTION_CHIP_CLASS,
  JOB_ACTION_FULL_CLASS,
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
export function DirectionsButton({
  location,
  variant = "full",
}: {
  location: string | null | undefined;
  /**
   * `"full"` is the original full-width row control.
   *
   * `"chip"` is the icon-over-label chip, for the shared `JobActionRow` — owner,
   * 2026-08-30: "directions messages and can't make it all need to be buttons
   * in a row side by side". It renders through the SAME
   * `JOB_ACTION_CHIP_CLASS`/`jobActionChipStyle` pair `JobActionChip` uses
   * (ShareJobButton does the identical thing for the same reason: this one owns
   * its own <a>, so it can't render through JobActionChip's <button>), which is
   * what keeps it geometrically identical to the chips beside it — same 44px
   * floor, same wrapping label, same tint.
   */
  variant?: "full" | "chip";
}) {
  const href = location ? mapsSearchUrl(location) : "";
  if (!href) return null;

  if (variant === "chip") {
    return (
      <Button
        asChild
        size="sm"
        variant="outline"
        className={JOB_ACTION_CHIP_CLASS}
        style={jobActionChipStyle("neutral")}
      >
        <a
          href={href}
          target="_blank"
          rel="noopener noreferrer"
          onClick={(e) => e.stopPropagation()}
          aria-label={`Directions — get directions to ${location}`}
        >
          <Navigation className="w-4 h-4" />
          <span className="text-ds-11 leading-tight font-medium">Directions</span>
        </a>
      </Button>
    );
  }

  return (
    <Button
      asChild
      size="sm"
      variant="outline"
      className={JOB_ACTION_FULL_CLASS}
      // `neutral`, not `primary`: Directions is navigational, a thing you do on
      // the way to the decision — it must not out-shout "I'm Done — Request
      // Payout" or the Accept/Decline pair. Same olivewood tint Message wears,
      // which is the tone this row already speaks in.
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
        aria-label={`Get directions to ${location}`}
      >
        <Navigation className="w-4 h-4" />
        Directions
      </a>
    </Button>
  );
}

export default DirectionsButton;
