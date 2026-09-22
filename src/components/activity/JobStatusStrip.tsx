import { AlertTriangle, Calendar, CheckCircle2, Clock, XCircle } from "lucide-react";
import type { JobStatusLine, JobStatusTone } from "./jobStatusLine";

/**
 * THE COLLAPSED CARD'S STATUS LINE — one strip, on both tabs.
 *
 * Owner, 2026-09-19: "in the box to the left of the dots should show what we
 * are waiting on… remove the dots", and on the look: "similar to how dispute
 * open displays."
 *
 * ── IT IS THE DISPUTE BADGE, GENERALISED. NOT A SECOND STRIP BESIDE IT ────
 * `DisputeOpenBadge` (the sienna "DISPUTE OPEN … Payment on hold" band) and
 * `PosterConfirmationBadge` (the bark "NEEDS YOUR OK … Confirm They Arrived"
 * band) were the same component written twice, each hard-coding one state. Both
 * are deleted and both are now VALUES of this one strip — a disputed card shows
 * one band, not two, and its words, tone and consequence line are unchanged
 * from the badge it replaces. Their data attributes survive on this element
 * (`data-dispute-open-badge`, `data-poster-owes-confirmation`) so the guards
 * that pin those two states keep pinning them.
 *
 * ── WHICH MAKES THE STRIP THE RULE, NOT THE EXCEPTION ─────────────────────
 * PostedJobCard's body carries a note explaining that the dispute badge is the
 * documented exception to "NO STATUS STRIPE" on that card. That exception is
 * now the rule — every collapsed card wears one — and the note says so. The
 * removed stripe was a coloured band repeating the FILTER TAB the reader was
 * standing in, once per card; this one says what the card is waiting on, which
 * is the thing no tab can tell you.
 *
 * ── IT FITS. THE ARITHMETIC IS A TEST, NOT A COMMENT ──────────────────────
 * The card's inner box is 212px at a 320 viewport and 262px at 375 (measured on
 * prod, both engines — src/test/jobStepRowWidthFloor.test.tsx). Laid out as
 * icon(12) + gap(6) + EYEBROW + gap(6) + detail, one line has 194px at 320 and
 * 244px at 375. 36 of the 38 lines in `jobStatusLine.ts` fit on ONE line at
 * 320; the two that do not — the escalated dispute on each card, at 210.3px —
 * wrap to exactly TWO, because `flex-wrap` drops the detail onto its own line
 * and each half is independently under 194px. Never three.
 * `src/test/collapsedStatusSentence.test.tsx` recomputes all of that from the
 * copy tables; a doc block claiming a width nobody measured is precisely how
 * the 12px primary shipped.
 *
 * ── COLOUR IS NEVER THE ONLY CHANNEL (WCAG 1.4.1) ─────────────────────────
 * Each tone carries an ICON and a WORD as well as a hue: a dispute is a warning
 * triangle over "Dispute open", your move is a tick over "Needs You", a wait is
 * a clock over "Waiting". Read in greyscale the strip still says which is which.
 *
 * ── AND IT ANNOUNCES AS ONE SENTENCE ──────────────────────────────────────
 * The two visible halves are separated by an `sr-only` dash, so assistive tech
 * reads "Needs You — Confirm they arrived" rather than two loose fragments.
 * There is no duplicated sr-only copy of the line: one text, two renderings of
 * it is how a screen reader ends up saying everything twice. This replaces the
 * compact rail's `aria-label` ("Job progress: step 5 of 8, Working"), which
 * described a position on a track nobody can act on and is gone with the dots.
 *
 * ── NOT A CONTROL ─────────────────────────────────────────────────────────
 * Tapping it does nothing of its own; the card's own expand gesture is
 * underneath. The strip says "open me", the card opens.
 */

interface ToneSkin {
  /** CSS custom property the border and wash are mixed from. */
  surface: string;
  /** The eyebrow's ink. */
  ink: string;
  icon: typeof AlertTriangle;
}

/*
 * ONE GLYPH PER MEANING, and the CHECK IS RESERVED (owner, 2026-09-21):
 *   "needs you shouldnt be a check, bc its not a checked off its we need you.
 *    done is the only thing wirh the check. waiting is good with the clock"
 * and on the family: "needs you be the yellow [alert], waiting be the clock and
 * done be the check".
 *
 * So: alert = something is owed, clock = waiting on time or on someone, check =
 * finished. A check means DONE and nothing else — it used to sit on `you` as
 * well, which told the reader a job they still owed work on was ticked off.
 *
 * `ahead` loses CalendarCheck for the same reason: it carries a check glyph, and
 * a scheduled job is not finished. A plain calendar says "a date is set".
 */
const TONE: Record<JobStatusTone, ToneSkin> = {
  // Unchanged from DisputeOpenBadge, to the token.
  alarm: { surface: "--burnt-sienna", ink: "--sienna-ink", icon: AlertTriangle },
  // AMBER, not bark. Bark is the primary-button green and reads as "good,
  // done"; this state is "we need you". Amber is already the app's attention
  // family, so no new colour enters the palette — and the right members of it:
  // `--amber-tint` is the token whose own comment says it is "used at low alpha
  // for fills/borders", which is exactly what `surface` is for here, and
  // `--amber-ink` is the text-grade one. `--amber` does not exist; naming it
  // would have emitted `hsl(var(--amber) / 0.08)` and painted nothing.
  you: { surface: "--amber-tint", ink: "--amber-ink", icon: AlertTriangle },
  them: { surface: "--olivewood", ink: "--olivewood", icon: Clock },
  ahead: { surface: "--olivewood", ink: "--olivewood", icon: Calendar },
  done: { surface: "--bark", ink: "--bark", icon: CheckCircle2 },
  over: { surface: "--olivewood", ink: "--olivewood", icon: XCircle },
};

export function JobStatusStrip({ line }: { line: JobStatusLine }) {
  const skin = TONE[line.tone];
  const Icon = skin.icon;
  return (
    <p
      className="px-4 py-2 flex items-center gap-1.5 flex-wrap"
      data-job-status-strip={line.id}
      data-job-status-tone={line.tone}
      /* The two guards that pin the states this strip absorbed keep their
         hooks. They are ATTRIBUTES rather than separate components now, which
         is the whole point: one band per card. */
      {...(line.tone === "alarm" ? { "data-dispute-open-badge": "" } : {})}
      {...(line.owesConfirmation ? { "data-poster-owes-confirmation": "" } : {})}
      style={{
        borderTop: `0.5px solid hsl(var(${skin.surface}) / 0.22)`,
        background: `hsl(var(${skin.surface}) / 0.08)`,
      }}
    >
      {/* Icon takes the INK, not the surface. The surface tokens are tuned for
          low-alpha washes and borders, so at full opacity some sit near 3:1 on
          the card; the ink tokens are text-grade by construction. One rule for
          every tone rather than an exception for amber. */}
      <Icon className="w-3 h-3 shrink-0" style={{ color: `hsl(var(${skin.ink}))` }} aria-hidden />
      {/*
        THE EYEBROW IS NO LONGER SHOWN (owner, 2026-09-21): "instead of saying
        needs you on the left. the left should say like the reason things are
        being held up or what they are waiting on or what they need to do to
        move forward."

        It repeated the FILTER TAB the reader was already standing in, twice per
        card — the same redundancy the removed colour stripe had. The reason is
        the thing no tab can tell you, so the reason is what the line says, and
        it says it on the LEFT rather than pushed to the far edge by `ml-auto`.

        It is still spoken, because whose move it is remains useful without
        sight of the tab, and it is still CARRIED IN THE DATA — which is what
        keeps `collapsedStatusSentence.test.tsx` able to hold every line filed
        under "Needs You" to actually being the reader's move. Dropping the
        field rather than the rendering would have retired that check.
      */}
      <span className="sr-only">{line.eyebrow} — </span>
      <span className="font-sans text-ds-11" style={{ color: `hsl(var(${skin.ink}))` }}>
        {line.detail}
      </span>
    </p>
  );
}
