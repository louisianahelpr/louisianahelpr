import { useState } from "react";
import type React from "react";
import { useInRouterContext, useNavigate } from "react-router-dom";
import { ShieldAlert, Share2, Loader2, Phone, MessageCircle, ChevronRight } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetHero,
  SheetFooter,
  SheetSecondaryAction,
} from "@/components/ui/sheet";
import { shareNative } from "@/lib/nativeShare";
import { isNativePlatform } from "@/lib/nativeInit";
import { report } from "@/lib/errorLogger";
import { JOB_ACTION_CHIP_CLASS, JOB_ROW_LABEL_CLASS } from "@/components/job-card/JobActionRow";

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
 * ONE shape: the action row's icon-over-label control
 * (`JOB_ACTION_CHIP_CLASS`), exactly like its neighbours. The doc block on the
 * component below records the second shape that used to live here and why it
 * is gone.
 *
 * The chip wears the ALERT family (lead ruling 2026-10-21, spec v2 §1.1:
 * rust is money only, destructive is --alert). It used to carry a burnt-sienna
 * tint and border, a rust-family hue on a control that is not money. The label
 * is --destructive-ink (= --alert-ink, lifted in dark for text), never the
 * --destructive fill, which reads about 2.3:1 as text on the dark card.
 */
const SOS_TINT = {
  color: "hsl(var(--destructive-ink))",
  background: "hsl(var(--destructive) / 0.06)",
  border: "0.5px solid hsl(var(--destructive) / 0.3)",
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

/**
 * ONE SHAPE, and it is the action row's (owner, 2026-09-19, second report:
 * "the buttons need to have the same size font and everything they shouldnt
 * have all different stuff").
 *
 * There used to be a `variant` prop: `"chip"` (the row control) and `"pill"` —
 * a hand-rolled `<button>` at `h-10`, `rounded-full`, `text-xs` and
 * `font-bold`: a height, a radius and a type token that appear nowhere else in
 * this row. `"pill"` was the DEFAULT and had no call site — the only consumer,
 * InProgressStep, passes the chip — so what shipped was the chip and what a
 * reader of this file would assume was normal was the pill. Deleted rather
 * than kept behind a flag: a control in this row that can be drawn two ways is
 * how the row ends up with two kinds of object in it.
 */
/**
 * WHEN SOS IS OFFERED — one rule for BOTH sides of the job (Q366, TS-007).
 * Gated on the Helpr actually BEING on site, and it ENDS when the job does: a
 * safety control that outlives the situation is noise. The poster's card and
 * the Helpr's card both read this, so they cannot disagree about the moment.
 */
export function sosOffered(job: {
  helper_arrived_at?: string | null;
  helper_completed_at?: string | null;
  poster_completed_at?: string | null;
}): boolean {
  return !!job.helper_arrived_at && !job.helper_completed_at && !job.poster_completed_at;
}

/**
 * THE CHIP AND THE SHEET ARE SEPARATE (owner, 2026-10-01: "Report a problem
 * and SOS must move under one More menu"). The chip now lives inside the
 * row's `More` panel (MORE_ONLY_CHIP_KEYS in JobStepCard), and that panel
 * unmounts when it closes. A sheet owned by the chip would unmount with it —
 * the confirmation would flash and vanish, or never open — so the caller owns
 * the open state and renders `SosShareSheet` OUTSIDE the panel (the card's
 * `dialogs` slot, or beside the step). Same button, same sheet, same handler.
 */
export function SosShareButton({ onOpen }: { onOpen: () => void }) {
  return (
    <Button
      variant="outline"
      size="sm"
      className={JOB_ACTION_CHIP_CLASS}
      style={{ ...SOS_TINT, border: SOS_TINT.border }}
      aria-label="SOS — share your location"
      // The 320px density gate measures every `[data-job-action-chip]` (Q1080).
      data-job-action-chip=""
      // No stopPropagation any more: the click has to reach the `More`
      // panel's own onClick so the panel closes behind the sheet, exactly as
      // Report a Problem's does. JobStepCard's root already stops it before
      // it can reach the card (which would toggle it).
      onClick={onOpen}
    >
      <ShieldAlert className="w-4 h-4" />
      <span className={JOB_ROW_LABEL_CLASS}>SOS</span>
    </Button>
  );
}

/**
 * Board 156's entry: the round shield button for a live job's header (the
 * deal-room chat header), owning its own sheet. Renders nothing unless SOS is
 * offered for this job (`sosOffered`: the Helpr is on site and the job is not
 * done), so a header can mount it unconditionally. Same sheet, same handler as
 * the job card's SOS chip.
 */
export function SafetyShieldButton({
  job,
}: {
  job: { id: string } & Parameters<typeof sosOffered>[0];
}) {
  const [open, setOpen] = useState(false);
  if (!sosOffered(job)) return null;
  return (
    <>
      <button
        type="button"
        aria-label="SOS — are you safe?"
        data-sos-shield=""
        onClick={() => setOpen(true)}
        className="shrink-0 inline-flex items-center justify-center w-11 h-11 rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 ring-offset-background"
        style={{
          border: "1.5px solid hsl(var(--destructive))",
          background: "hsl(var(--card))",
          color: SOS_TINT.color,
        }}
      >
        <ShieldAlert className="w-5 h-5" aria-hidden />
      </button>
      <SosShareSheet jobId={job.id} open={open} onOpenChange={setOpen} />
    </>
  );
}

export function SosShareSheet({
  jobId,
  open,
  onOpenChange,
}: {
  jobId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const setOpen = onOpenChange;
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
    <Sheet open={open} onOpenChange={setOpen}>
      {/* Board 156, "Are you safe?" (spec v2 §9.31). Restyle of the existing
          flow only: everything here is something the app really does. Left out
          on purpose (truth rule): the board's live-location toggle to "Helpr
          Safety", "Leave and end the job", and the other side's "Paused by
          Helpr Safety" state. None of them exists server-side: sharing sends
          ONE position to the person you pick, through the phone's share
          sheet. */}
      <SheetContent side="bottom">
        <SheetHero title="Are you safe?" />
        {/* THE EMERGENCY NUMBER (TS-007), the one big alert fill on the sheet
            (board 156). A real `tel:` link, not a handler: the OS dialer opens
            on web and in the native shell alike.
            Guard: src/test/sosOffersEmergencyCall.test.ts. */}
        <a
          href="tel:911"
          aria-label="Call 911"
          data-sos-call-911=""
          className="mt-3 flex w-full items-center justify-center gap-2 h-14 rounded-full font-sans font-bold text-ds-16 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 ring-offset-background"
          style={{ background: "hsl(var(--destructive))", color: "hsl(var(--destructive-foreground))" }}
        >
          <Phone className="w-5 h-5" aria-hidden />
          Call 911
        </a>
        <p className="text-ds-13 text-muted-foreground mt-2">
          In immediate danger? Call 911 first. It calls from your phone.
        </p>

        <div
          className="mt-4 rounded-2xl overflow-hidden"
          // Inline, not `bg-card`: the T2 card rule makes every .bg-card
          // border transparent (!important).
          style={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))" }}
        >
          <SafetyRow
            onClick={share}
            disabled={locating}
            busy={locating}
            icon={locating ? <Loader2 className="w-5 h-5 motion-safe:animate-spin" /> : <Share2 className="w-5 h-5" />}
            title={locating ? "Getting your location…" : "Share my location"}
            sub="Sends where you are right now to someone you pick. It does not alert us or emergency services."
          />
          <div aria-hidden className="mx-4" style={{ borderTop: "1px solid hsl(var(--border))" }} />
          <TalkToHelprRow disabled={locating} onGo={() => setOpen(false)} />
        </div>

        {/* ONE dismiss, through the shared footer: "I'm safe now" closes the
            sheet (board 156). The share is a row above, not a footer commit. */}
        <SheetFooter className="mt-4">
          <SheetSecondaryAction onClick={() => setOpen(false)} disabled={locating}>
            I'm safe now
          </SheetSecondaryAction>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}

const SUPPORT_TALK_PATH = "/support?topic=message";

/**
 * Talk to Helpr: the support form's "Talk to a real person" topic. Board 156
 * says "A real person, now"; the real process is a person reading every
 * message (supportTopics.ts), so the row promises exactly that and no speed.
 * Router-optional: the sheet also renders in harnesses with no router, where
 * it falls back to a plain page load of the same path.
 */
function TalkToHelprRow({ disabled, onGo }: { disabled: boolean; onGo: () => void }) {
  const inRouter = useInRouterContext();
  return inRouter ? (
    <TalkToHelprRouted disabled={disabled} onGo={onGo} />
  ) : (
    <TalkToHelprButton disabled={disabled} onClick={() => { onGo(); window.location.assign(SUPPORT_TALK_PATH); }} />
  );
}

function TalkToHelprRouted({ disabled, onGo }: { disabled: boolean; onGo: () => void }) {
  const navigate = useNavigate();
  return <TalkToHelprButton disabled={disabled} onClick={() => { onGo(); navigate(SUPPORT_TALK_PATH); }} />;
}

function TalkToHelprButton({ disabled, onClick }: { disabled: boolean; onClick: () => void }) {
  return (
    <SafetyRow
      onClick={onClick}
      disabled={disabled}
      icon={<MessageCircle className="w-5 h-5" />}
      title="Talk to Helpr"
      sub="A real person reads every message"
    />
  );
}

/** One tappable row in the safety sheet's list card (board 156). */
function SafetyRow({
  onClick,
  disabled,
  busy,
  icon,
  title,
  sub,
}: {
  onClick: () => void;
  disabled?: boolean;
  busy?: boolean;
  icon: React.ReactNode;
  title: string;
  sub: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-busy={busy || undefined}
      className="ctl-tint w-full flex items-center gap-3 min-h-[60px] px-4 py-3 text-left disabled:opacity-60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
    >
      <span aria-hidden className="shrink-0" style={{ color: "hsl(var(--bark))" }}>
        {icon}
      </span>
      <span className="flex-1 min-w-0">
        <span className="block font-sans font-semibold text-ds-14 leading-snug text-foreground">{title}</span>
        <span className="block text-ds-12 text-muted-foreground mt-0.5 leading-snug">{sub}</span>
      </span>
      <ChevronRight aria-hidden className="shrink-0 w-4 h-4 text-muted-foreground" />
    </button>
  );
}
