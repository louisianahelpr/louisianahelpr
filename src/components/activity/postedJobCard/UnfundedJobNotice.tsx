import { Button } from "@/components/ui/button";
import { EyeOff, Loader2 } from "lucide-react";
import { type Job } from "../activityConstants";

/**
 * "No Helpr can see this yet — here is the button that fixes it."
 *
 * Two different jobs land in this state and the poster's question differs.
 *
 * 1. `str-ical-sync` inserts a cleaning job at each guest checkout with
 *    `payment_status` left at `'unpaid'`. Every browse surface requires a
 *    funded status, so the row is invisible to every helper — while this card,
 *    which reads `public.jobs` directly, shows it looking perfectly normal. A
 *    host sees "0 applicants" and concludes the app is quiet.
 *
 * 2. The poster hand-posted a job, reached Stripe Checkout, and abandoned it.
 *    Same invisibility, but they have no idea their payment never completed —
 *    the job sits in My Posts looking posted. Before 2026-09-06 this case
 *    showed NOTHING: the rule required `is_auto_created`, so the ghost job had
 *    no notice and no way to finish paying.
 *
 * In both cases the copy names the STATE ("no Helpr can see it"), not the
 * mechanism ("payment_status is unpaid"), because the poster's question is why
 * nobody has applied.
 */

/**
 * WHY this job is unfunded — the two causes need different words.
 *
 * `null` means "say nothing": the job is funded, or no longer open (an
 * unfunded cancelled job needs no CTA), or it is a hand-posted job still
 * mid-redirect to Stripe.
 */
export type UnfundedCause = "calendar" | "abandoned-checkout";

export function unfundedNoticeCause(job: Job): UnfundedCause | null {
  /* 'abandoned' rides with 'unpaid' because they are the same fact to the
     poster and to every browse surface: the money never landed, so all four
     feeds filter the row out and no helper can see it. Which of the two a job
     carries is internal bookkeeping about how the checkout ended, not a
     difference this card should render — and prod holds live open rows in BOTH
     states, so keying on 'unpaid' alone left every 'abandoned' one as exactly
     the silent ghost this notice exists to prevent. */
  /* 'failed' is the THIRD one, and the one a declined card produces: the
     stripe-webhook payment_intent.payment_failed handler stamps it on a job
     that is still unpaid, so a poster whose 4000-0000-0000-0002 (or real
     maxed-out card) was refused, who then backed out of Checkout, holds an
     open job in 'failed' — filtered out of every feed exactly like the other
     two. Measured 2026-09-07: that job rendered in My Posts › Waiting as a
     healthy "Posted" card with Applicants / Share / Boost and no word about
     the payment, while no Helpr could ever see it. The notice is the same:
     a Checkout was minted (stripe_session_id proves it), it did not land,
     finish paying. */
  const unfunded =
    job.payment_status === "unpaid" ||
    job.payment_status === "abandoned" ||
    job.payment_status === "failed";
  if (!unfunded || job.status !== "open") return null;

  // Auto-created by str-ical-sync. Nobody ever opened a checkout for it.
  if (job.is_auto_created === true) return "calendar";

  // Hand-posted, and the poster reached Stripe and did not finish.
  //
  // `stripe_session_id` is the discriminator, and it is trustworthy because it
  // is SERVER-OWNED: enforce_jobs_insert_column_lock forces it to NULL on every
  // poster INSERT, so only create-payment can ever set it. Its presence
  // therefore PROVES a Checkout Session was minted for this job.
  //
  // That is what makes it safe to widen this notice to hand-posted jobs at all.
  // The original rule excluded them because the post-a-job flow inserts the row
  // and THEN redirects, leaving every healthy job 'unpaid' for a few seconds —
  // flashing "not posted yet" there would accuse the working path of being
  // broken. In that window `stripe_session_id` is still NULL, so the notice
  // stays off exactly where it used to.
  if (job.stripe_session_id) return "abandoned-checkout";

  return null;
}

export function shouldShowUnfundedNotice(job: Job): boolean {
  return unfundedNoticeCause(job) !== null;
}

interface Props {
  job: Job;
  onFund: (jobId: string) => void;
  funding: boolean;
}

export function UnfundedJobNotice({ job, onFund, funding }: Props) {
  const cause = unfundedNoticeCause(job);
  if (!cause) return null;

  // Both say the same true thing — no Helpr can see this, and here is the one
  // button that fixes it. They differ on the half the poster does not know:
  // where the job came from, or that their own checkout never finished.
  const abandoned = cause === "abandoned-checkout";
  const heading = abandoned ? "Payment not finished" : "Not posted yet";
  const body = abandoned
    ? "Your checkout wasn't completed, so this job is still private — no Helpr can see it or apply. Finish paying to publish it."
    : "We created this from your calendar, but no Helpr can see it until it's funded. Fund it to publish and start getting applicants.";
  const cta = abandoned ? "Finish paying" : "Fund & publish";

  return (
    <div className="rounded-xl border border-[hsl(var(--burnt-sienna))]/30 bg-[hsl(var(--burnt-sienna))]/5 p-3">
      <div className="flex items-start gap-2">
        <EyeOff className="mt-0.5 h-4 w-4 shrink-0 text-[hsl(var(--accent-ink))]" aria-hidden="true" />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium text-foreground">{heading}</p>
          <p className="mt-0.5 text-sm text-muted-foreground">{body}</p>
          <Button
            size="sm"
            className="btn-grad-primary mt-2.5 w-full sm:w-auto"
            onClick={() => onFund(job.id)}
            disabled={funding}
          >
            {funding ? (
              <>
                <Loader2 className="mr-1.5 h-4 w-4 animate-spin" aria-hidden="true" />
                Starting checkout…
              </>
            ) : (
              cta
            )}
          </Button>
        </div>
      </div>
    </div>
  );
}
