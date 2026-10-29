/**
 * The job page's pieces (boards 15, 42, 168, 169): the four-step tracker, the
 * poster's money card, the Helpr's take-home card and the "posted by" card.
 * Rust is money only (spec §1.1); every figure comes from the job row or the
 * real fee rule, or it is not shown (§1.5).
 */
import { formatPrice, formatPriceFloor } from "@/lib/format";
import { computeNet } from "@/components/dashboard/JobPrice";
import { helperShareCount } from "@/lib/helperEarnings";
import { useFirstPayoutFeeDollars } from "@/hooks/useFirstPayoutFee";
import { tierFeePercent } from "@/lib/subscriptionTiers";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { DeclutterSellerCard } from "@/components/declutter/DeclutterSellerCard";
import type { JobPageRow } from "./useJobPage";
import { JobProgress } from "@/components/tracker/JobProgress";
import { useJobRescheduled } from "@/hooks/useJobRescheduled";
import { jobProgress } from "@/components/tracker/jobProgressState";
import { useFeature } from "@/hooks/useFeature";
import { helperProgress } from "@/pages/jobs/appliedJobCard/steps/helperProgress";
import type { Job } from "@/components/job-card/activityConstants";

const CARD = "rounded-2xl border border-border bg-card p-4 lg:border-0 lg:p-0 lg:rounded-none lg:bg-transparent lg:!shadow-none";
const MONEY = "text-[hsl(var(--burnt-sienna))]";

/**
 * The job page's tracker is THE one tracker (owner, 2026-10-21): the same four segments and next line as
 * chat and the job cards (jobProgress). A Helpr browsing an open job is not on it yet: no tracker for them.
 */
export function JobTracker({ job, side, trackingStatus = null }: { job: JobPageRow; side: "poster" | "helpr" | null; trackingStatus?: string | null }) {
  const rescheduled = useJobRescheduled(job.id, !!side && job.status === "accepted");
  if (!side) return null;
  // The Working card's own progress (helperProgress off the tracking row), so the page's line and the card's agree.
  const progress = jobProgress(job, {
    viewer: side,
    rescheduled,
    workUnderway: helperProgress(job as unknown as Job, trackingStatus).workUnderway,
    tracking: trackingStatus ? { status: trackingStatus } : null,
  });
  if (progress.stage === null && !progress.next) return null;
  return (
    <div data-job-tracker="" className="rounded-2xl border border-border bg-card p-4 lg:border-0 lg:bg-transparent lg:p-0 lg:pt-1 lg:!shadow-none">
      <JobProgress progress={progress} />
    </div>
  );
}

/** How the poster's money stands, from payment_status. Unlisted states print nothing rather than a guess. */
const HELD_LINE: Partial<Record<string, string>> = {
  escrow: "Paid when you posted. We hold it until the job is done.",
  // Q2399: the card is held (or, far out, only saved) at posting and charged at the hire.
  held: "Your card isn't charged until you hire someone.",
  unpaid: "Not paid yet. Helprs can't see this job until it's paid.",
  abandoned: "Not paid yet. Helprs can't see this job until it's paid.",
  refunded: "Refunded to your card.",
  released: "Paid out to your Helpr.",
};

/**
 * Under card_hold_at_post (Q2399, the flag the checkout step's copy follows) a card is charged at the
 * hire, not at posting, so a paid job's line no longer says when (audit 2026-10-28 F4: "Paid when you
 * posted" on a job whose card was captured at the hire). A bank payment or a gift is still paid at
 * posting; "Paid" is true for every way the job was funded.
 */
const PAID_UNDER_CARD_HOLD = "Paid. We hold it until the job is done.";

export function PosterMoney({ job, total, loading }: { job: JobPageRow; total: number; loading: boolean }) {
  const cardHoldOn = useFeature("card_hold_at_post");
  const line = job.payment_status === "escrow" && cardHoldOn ? PAID_UNDER_CARD_HOLD : HELD_LINE[job.payment_status ?? ""];
  return (
    <div data-poster-money="" className={`${CARD} lg:border-t lg:!border-border lg:pt-4`}>
      <div className="flex items-baseline justify-between gap-3">
        <p className="text-ds-15 font-semibold">Your budget</p>
        <p className={`text-ds-28 font-bold tabular-nums leading-none ${MONEY}`}>${formatPrice(job.budget)}</p>
      </div>
      {line && <p className="mt-1.5 text-ds-13 text-muted-foreground">{line}</p>}
      {/* Zero applicants is the page's own "No applicants yet" block (board 57), not a line here. */}
      {job.status === "open" && !loading && total > 0 && (
        <p data-applicant-count="" className="mt-3 border-t border-border pt-3 text-ds-14 font-semibold">
          {`${total} applicant${total === 1 ? "" : "s"}`}
        </p>
      )}
    </div>
  );
}

export function HelprMoney({ job }: { job: JobPageRow }) {
  const firstPayoutFee = useFirstPayoutFeeDollars();
  const { profile } = useCurrentUser();
  // Split only on a group job (helperShareCount; helpersNeededSplitIsGroupGated).
  const helpers = helperShareCount(job);
  // A fee-stamped job pays by its stamp; an older unstamped job is
  // charged the viewer's own tier rate at payout, the same rate the feed's
  // "You earn" figure uses (useDashboardData: tierFeePercent of the profile).
  const tierPct = tierFeePercent(profile?.subscription_tier, profile?.subscription_expires_at);
  const net = computeNet(job.budget, tierPct, job.urgent_fee ?? 0, helpers, job.status === "disputed" ? 0 : firstPayoutFee, job).netEarnings;
  // Owner 2026-10-25: members never see the Helpr fee, its rate or its maths,
  // only the take-home (and the one-time setup fee on the payout it comes out of).
  const lines = [
    helpers > 1 ? `Your share of a job for ${helpers} Helprs.` : null,
    firstPayoutFee > 0 && job.status !== "disputed" ? `After the one-time $${formatPrice(firstPayoutFee)} setup fee, taken from your first payout.` : null,
  ].filter(Boolean);
  return (
    <div data-helpr-money="" className={`${CARD} lg:border-t lg:!border-border lg:pt-4`}>
      <div className="flex items-baseline justify-between gap-3">
        <p className="text-ds-15 font-semibold">You take home</p>
        <p className={`text-ds-28 font-bold tabular-nums leading-none ${MONEY}`}>${formatPriceFloor(net)}</p>
      </div>
      {lines.length > 0 && <p className="mt-1.5 text-ds-13 text-muted-foreground">{lines.join(" ")}</p>}
    </div>
  );
}

export function PostedBy({ posterId }: { posterId: string }) {
  return (
    <section aria-label="Posted by">
      <DeclutterSellerCard sellerId={posterId} noun="poster" />
    </section>
  );
}
