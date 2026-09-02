import { useState } from "react";
import { ShieldAlert, Share2, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetHero } from "@/components/ui/sheet";
import { shareNative } from "@/lib/nativeShare";
import { isNativePlatform } from "@/lib/nativeInit";
import { report } from "@/lib/errorLogger";
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

/**
 * Read the device's current position ONCE, imperatively, at the moment the
 * user asks to share it.
 *
 * Not `useUserLocation`: that hook is declarative (fires on mount/enable) and
 * front-loads a "why we want location" rationale dialog which is session-gated
 * and can defer the read. Neither is right here — the position must be the one
 * the person is standing at when they press the button in an emergency, and
 * there is no room for an extra modal in front of it. The branch logic
 * (Capacitor plugin on native, `navigator.geolocation` on web) mirrors that
 * hook deliberately; the WKWebView geolocation shim is unreliable inside the
 * native shell, which is why native goes through the plugin.
 *
 * Resolves `null` rather than throwing — a denied permission is an ordinary
 * outcome the caller has to degrade for, not an exception.
 */
async function readCurrentPosition(jobId: string): Promise<{ lat: number; lng: number } | null> {
  const opts = { enableHighAccuracy: true, timeout: 10_000, maximumAge: 30_000 };
  try {
    if (isNativePlatform) {
      const { Geolocation } = await import("@capacitor/geolocation");
      const pos = await Geolocation.getCurrentPosition(opts);
      return { lat: pos.coords.latitude, lng: pos.coords.longitude };
    }
    if (typeof navigator === "undefined" || !navigator.geolocation) return null;
    return await new Promise((resolve) => {
      navigator.geolocation.getCurrentPosition(
        (pos) => resolve({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
        () => resolve(null),
        opts,
      );
    });
  } catch (err) {
    // A failed SOS location read is worth knowing about per job, not just in
    // aggregate — it is the one path where "we degraded gracefully" still
    // means someone's contact did not get told where they are.
    report(err, {
      severity: "warning",
      tags: { source: "SosShareButton.geolocation" },
      context: { job_id: jobId },
    });
    return null;
  }
}

export function SosShareButton({
  jobId,
  variant = "pill",
}: {
  jobId: string;
  variant?: "pill" | "chip";
}) {
  const [open, setOpen] = useState(false);
  const [locating, setLocating] = useState(false);

  /**
   * WHAT THIS SHARES, AND WHY IT IS NOT A HELPR LINK
   * ------------------------------------------------
   * This used to share `https://www.louisianahelpr.com/track/${jobId}` — as
   * both the `url` AND inlined a second time in the `text`. **There is no
   * `/track/:jobId` route.** It is not in `App.tsx` and never has been, so the
   * link fell through to the `*` catch-all: following it (verified against
   * production, signed out) returns the app's "404 — This page doesn't exist
   * or has been moved" screen. The single control in this app that someone
   * reaches for when they feel unsafe was sending their contact a dead link
   * that said "You can reach me at:" above it. Nothing threw and nothing
   * logged, because a wrong-but-well-formed URL is not an error to the OS.
   *
   * So it now sends the thing the button's own label promises: the sharer's
   * ACTUAL coordinates, as a `maps.google.com/?q=lat,lng` link. That resolves
   * for anyone — no Helpr account, no app install, no login wall — and opens
   * in Apple Maps on iOS and Google Maps elsewhere. It is also the only
   * payload here that is still true if Helpr is down.
   *
   * If the position cannot be read (permission denied, no fix, web without
   * geolocation) the share goes out with NO `url` at all rather than a filler
   * one, and the text says plainly that the location could not be attached.
   * A recipient who is told "location unavailable" can act on that; a
   * recipient handed a 404 believes they have a live link.
   */
  const share = async () => {
    if (locating) return;
    setLocating(true);
    // `readCurrentPosition` never rejects — it try/catches and resolves null on
    // every failure path — so `.finally` is exactly the old try/finally, minus
    // the `= null` initializer that was never read.
    const pos = await readCurrentPosition(jobId).finally(() => setLocating(false));
    setOpen(false);

    if (!pos) {
      // Say it BEFORE the sheet opens, so the user knows what is (and is not)
      // in the message they are about to send. `toast.error` is the one
      // channel `src/lib/toastPolicy.ts` leaves alive.
      toast.error("Couldn't get your location", {
        description: "Sharing without it — turn on location access and try again.",
      });
      await shareNative({
        title: "I'm on a Helpr job",
        text: "I'm currently on a Helpr job. My phone couldn't share my location — please check in with me.",
        dialogTitle: "Share your status",
      });
      return;
    }

    const mapUrl = `https://maps.google.com/?q=${pos.lat},${pos.lng}`;
    await shareNative({
      title: "I'm on a Helpr job — here's my location",
      // The URL is NOT repeated inside the text. It used to be, so the
      // clipboard tier pasted the same link twice in a row.
      text: "I'm currently on a Helpr job. This is where I am right now:",
      url: mapUrl,
      dialogTitle: "Share your location",
      clipboardText: `I'm currently on a Helpr job. This is where I am right now: ${mapUrl}`,
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
            {/* Reading a GPS fix takes up to 10s, and this button used to
                jump straight to the share sheet because it had nothing to
                fetch. Without a pending state the gap between tap and sheet
                reads as the button not working — the failure mode this whole
                control has to be free of. */}
            <Button
              variant="destructive"
              className="w-full"
              disabled={locating}
              aria-busy={locating}
              onClick={share}
            >
              {locating ? (
                <Loader2 className="w-4 h-4 mr-2 motion-safe:animate-spin" />
              ) : (
                <Share2 className="w-4 h-4 mr-2" />
              )}
              {locating ? "Getting your location…" : "Share Location Link"}
            </Button>
            <Button variant="ghost" className="w-full" onClick={() => setOpen(false)} disabled={locating}>
              Cancel
            </Button>
          </div>
        </SheetContent>
      </Sheet>
    </>
  );
}
