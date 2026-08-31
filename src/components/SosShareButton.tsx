import { useState } from "react";
import { ShieldAlert, Share2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetHero } from "@/components/ui/sheet";
import { shareNative } from "@/lib/nativeShare";
import { JOB_ACTION_CHIP_CLASS } from "@/components/activity/JobActionRow";

/**
 * The SOS "share my location" control and its confirmation sheet.
 *
 * Extracted from {@link JobTracking}, which used to own both the button and the
 * sheet state. The owner moved SOS out of the tracker's header and into the
 * card's action row ("move sos to the left of messages"), which put the button
 * in a DIFFERENT component tree from the sheet that opens it — so the pair had
 * to become one self-contained unit rather than the sheet being lifted into a
 * shared ancestor.
 *
 * Two shapes, one behaviour:
 *  - `pill`  — the original rounded pill. Still what a HELPER sees in the
 *              tracker header; their card was not part of the reorganisation
 *              and is deliberately left looking exactly as it did.
 *  - `chip`  — icon-over-label, matching its neighbours in the owner's
 *              Share / Message row.
 *
 * The burnt-sienna tint and border are carried across verbatim from the old
 * header pill, so the control reads the same in both shapes.
 *
 * The LABEL is --danger-ink, not raw --burnt-sienna. A raw brand hue has no
 * dark sibling: on the dark canvas it resolved to rgb(212,103,53) over its own
 * 0.08 tint and measured 4.12:1 at 14px/700 — under AA, on the one control in
 * the app somebody reaches for when they feel unsafe. --danger-ink exists for
 * exactly this (see its note in index.css, minted when the same defect hit the
 * Cancel chip at 1.92:1) and carries a 70%-lightness dark value that sits level
 * with its --info / --boost / --amber siblings, so the action row stays even.
 * Light mode is unchanged in feel — a deep red where the sienna was.
 */
const SOS_TINT = {
  color: "hsl(var(--danger-ink))",
  background: "hsl(var(--burnt-sienna) / 0.08)",
  border: "0.5px solid hsl(var(--burnt-sienna) / 0.22)",
} as const;

export function SosShareButton({
  jobId,
  variant = "pill",
}: {
  jobId: string;
  variant?: "pill" | "chip";
}) {
  const [open, setOpen] = useState(false);

  const share = async () => {
    setOpen(false);
    await shareNative({
      title: "I'm on a Helpr job — share my location",
      text: `I'm currently on a Helpr job. You can reach me at: https://www.louisianahelpr.com/track/${jobId}`,
      url: `https://www.louisianahelpr.com/track/${jobId}`,
      dialogTitle: "Share your location",
    });
  };

  return (
    <>
      {variant === "chip" ? (
        <Button
          variant="outline"
          size="sm"
          className={JOB_ACTION_CHIP_CLASS}
          style={{ ...SOS_TINT, border: SOS_TINT.border }}
          aria-label="SOS — share your location"
          onClick={(e) => {
            e.stopPropagation();
            setOpen(true);
          }}
        >
          <ShieldAlert className="w-4 h-4" />
          <span className="text-ds-11 leading-none font-medium">SOS</span>
        </Button>
      ) : (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            setOpen(true);
          }}
          aria-label="SOS — share your location"
          className="h-10 px-3 rounded-full inline-flex items-center gap-1.5 text-xs font-bold shrink-0 active:scale-95 transition-all"
          style={{
            color: SOS_TINT.color,
            background: SOS_TINT.background,
            border: "1px solid hsl(var(--burnt-sienna) / 0.22)",
          }}
        >
          <ShieldAlert className="w-3.5 h-3.5" />
          SOS
        </button>
      )}

      <Sheet open={open} onOpenChange={setOpen}>
        {/* No bespoke padding or ground. `side="bottom"` is a centred modal at
          every width now, not a floor-anchored sheet, so the safe-area bottom
          inset each sheet had written differently is dead weight — and
          `.glass-modal` is THE popup surface. Shared `p-4 sm:p-5`, same ramp
          DialogContent uses. */}
      <SheetContent side="bottom">
          <SheetHero title="Share Your Location" />
          <div className="mt-4 space-y-2">
            {/* Shared destructive variant, not a hand-written burnt-sienna
                fill. Broadcasting your live location is a safety action the
                sender cannot recall, so it takes the one destructive
                treatment; it was a sixth inline colour. */}
            <Button
              variant="destructive"
              className="w-full"
              onClick={share}
            >
              <Share2 className="w-4 h-4 mr-2" />
              Share Location Link
            </Button>
            <Button variant="ghost" className="w-full" onClick={() => setOpen(false)}>
              Cancel
            </Button>
          </div>
        </SheetContent>
      </Sheet>
    </>
  );
}
