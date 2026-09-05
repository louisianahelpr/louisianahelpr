import { Button } from "@/components/ui/button";
import { EyeOff, Loader2 } from "lucide-react";
import { type Job } from "../activityConstants";

/**
 * "Not posted yet — fund to publish", for a job the calendar sync created but
 * nobody paid for.
 *
 * `str-ical-sync` inserts a cleaning job at each guest checkout with
 * `payment_status` left at `'unpaid'`, and every browse surface requires a
 * funded status. The row is therefore invisible to every helper — while this
 * card, which reads `public.jobs` directly, shows it looking perfectly normal.
 * A host would see "0 applicants" and conclude the app is quiet, when in fact
 * no helper was ever able to see the job at all.
 *
 * So the card has to say the thing the data does not: this is not live. The
 * copy names the state ("no helper can see it"), not the mechanism
 * ("payment_status is unpaid"), because the host's question is why nobody has
 * applied.
 */
export function shouldShowUnfundedNotice(job: Job): boolean {
  // Only auto-created rows. A hand-posted job is unpaid for a few seconds
  // between insert and the Stripe redirect, and flashing this on it would
  // accuse the normal flow of being broken. It also stays out of the way once
  // the job is cancelled or done — an unfunded cancelled job needs no CTA.
  return (
    job.is_auto_created === true &&
    job.payment_status === "unpaid" &&
    job.status === "open"
  );
}

interface Props {
  job: Job;
  onFund: (jobId: string) => void;
  funding: boolean;
}

export function UnfundedJobNotice({ job, onFund, funding }: Props) {
  return (
    <div className="rounded-xl border border-[hsl(var(--burnt-sienna))]/30 bg-[hsl(var(--burnt-sienna))]/5 p-3">
      <div className="flex items-start gap-2">
        <EyeOff className="mt-0.5 h-4 w-4 shrink-0 text-[hsl(var(--accent-ink))]" aria-hidden="true" />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium text-foreground">Not posted yet</p>
          <p className="mt-0.5 text-sm text-muted-foreground">
            We created this from your calendar, but no Helpr can see it until it's funded.
            Fund it to publish and start getting applicants.
          </p>
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
              "Fund & publish"
            )}
          </Button>
        </div>
      </div>
    </div>
  );
}
