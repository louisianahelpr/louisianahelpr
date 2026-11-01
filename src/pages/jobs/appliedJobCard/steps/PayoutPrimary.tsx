import { CheckCircle2 } from "lucide-react";
import { JobStepPrimaryButton } from "@/components/job-card/JobActionRow";
import { JobStepRowSlot } from "@/components/job-card/jobStepRow";
import { doneFloorNote } from "@/lib/doneFloor";
import { SELL_FOR_ME_DONE_NOTE, isSellForMeJob } from "@/lib/declutter/sellForMe";

/**
 * The ONE primary action of a live job: "Mark job complete" (owner,
 * 2026-09-14 — was "I'm Done — Request Payout"; same words as the tracker's
 * Done CTA).
 *
 * Extracted so the two steps that can offer it (on site, working) cannot draw
 * it differently — the disabled "Available in N min" state travels with it.
 *
 * ONE ROW, AND THE TRACKER'S CTA WINS (owner, 2026-09-14, VN-21). This is the
 * step's `primary` prop, which JobStepCard renders only when nothing nested
 * has claimed the row's primary slot. On these two steps the tracker's own
 * next-step CTA ("Start working", then "Mark job complete") normally has, so
 * this stands down — it used to render as a SECOND "Mark job complete" under
 * the tracker's identical one (singlePrimaryCta.test.tsx pinned that at 2).
 * The 30-minute sentence is no longer part of the button for the same reason:
 * see {@link PayoutUnlockNote}, which the step renders whichever control is
 * the primary.
 *
 * The bark fill painted over the gloss is gone too: the row's primary wears
 * `btn-grad-primary` and nothing on top of it (JobStepPrimaryButton).
 *
 * THE DISABLED TWIN IS STILL GONE. While a required photo is missing this
 * renders NOTHING (the caller passes `hasPhotos={false}`); it used to render a
 * dead full-width button reading "Upload before & after photos first" — an
 * instruction wearing the costume of the action it was refusing, directly under
 * the uploader that carries the instruction out.
 */
export function PayoutPrimary({
  hasPhotos,
  busy,
  tooEarly,
  minutesLeft,
  onComplete,
}: {
  hasPhotos: boolean;
  busy: boolean;
  tooEarly: boolean;
  minutesLeft: number;
  onComplete: () => void;
}) {
  if (!hasPhotos) return null;
  return (
    <JobStepPrimaryButton
      icon={CheckCircle2}
      label={busy ? "…" : tooEarly ? `Available in ${minutesLeft} min` : "Mark job complete"}
      onClick={onComplete}
      disabled={busy || tooEarly}
    />
  );
}

/**
 * Why completion is not available yet, on the line directly above the row.
 *
 * Rendered by the step, not by PayoutPrimary, because the control it explains
 * is usually the TRACKER's "Mark job complete" (which enforces the same
 * 30-minute floor on tap) — and the helper watching the clock needs the
 * minutes whichever control is drawn.
 */
export function PayoutUnlockNote({
  hasPhotos,
  tooEarly,
  minutesLeft,
}: {
  hasPhotos: boolean;
  tooEarly: boolean;
  minutesLeft: number;
}) {
  if (!hasPhotos || !tooEarly) return null;
  return (
    <JobStepRowSlot slot="note">
      <p className="font-sans text-center text-ds-11" style={{ color: "hsl(var(--olivewood) / 0.8)" }}>
        {doneFloorNote(minutesLeft)}
      </p>
    </JobStepRowSlot>
  );
}

/**
 * LEAD-LIST-FOR-SELLER: a "Have a Helpr list it" job is done once its listings are SENT for the seller's approval (the
 * server refuses completion_requires_listings_sent before then: 20261101034159). Said on the line above the row while
 * the work is on, so the Helpr knows before the tap, not from the refusal.
 */
export function SellForMeDoneNote({ job }: { job: { category?: string | null; helper_completed_at?: string | null } | null | undefined }) {
  if (!job || !isSellForMeJob(job.category) || job.helper_completed_at) return null;
  return (
    <JobStepRowSlot slot="note">
      <p className="font-sans text-center text-ds-11" style={{ color: "hsl(var(--olivewood) / 0.8)" }} data-sell-for-me-done-note="">
        {SELL_FOR_ME_DONE_NOTE}
      </p>
    </JobStepRowSlot>
  );
}
