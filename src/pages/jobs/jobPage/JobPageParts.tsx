/**
 * The job page's pieces (boards 15, 42, 168, 169): the four-step tracker, the
 * poster's money card, the Helpr's take-home card and the "posted by" card.
 * Rust is money only (spec §1.1); every figure comes from the job row or the
 * real fee rule, or it is not shown (§1.5).
 */
import { Link } from "react-router-dom";
import { formatPrice, formatPriceFloor } from "@/lib/format";
import { setupFeeWords } from "@/lib/takeHomeFeeWords";
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
import { helperProgress } from "@/pages/jobs/appliedJobCard/steps/helperProgress";
import type { Job } from "@/components/job-card/activityConstants";
import { isGiveawayFixedPayJob } from "@/lib/helprFlatFee";

const CARD = "rounded-2xl border border-border bg-card p-4 lg:border-0 lg:p-0 lg:rounded-none lg:bg-transparent lg:!shadow-none";
const MONEY = "text-[hsl(var(--burnt-sienna))]";

/**
 * The job page's tracker is THE one tracker (owner, 2026-10-21): the same four segments and next line as
 * chat and the job cards (jobProgress). A Helpr browsing an open job is not on it yet: no tracker for them.
 */
export function JobTracker({ job, side, trackingStatus = null, pendingApplicants, otherFirst = null, hideNext = false }: {
  job: JobPageRow; side: "poster" | "helpr" | null; trackingStatus?: string | null; pendingApplicants?: number;
  /** The page says the step above the tracker (OnTheWayNow): the tracker draws its bar without repeating the line. */
  hideNext?: boolean;
  /** The other person's first name, as the page's own buttons name them ("Message Eli"); null reads "Your Helpr". */
  otherFirst?: string | null;
}) {
  const rescheduled = useJobRescheduled(job.id, !!side && job.status === "accepted");
  if (!side) return null;
  // The Working card's own progress (helperProgress off the tracking row), so the page's line and the card's agree.
  const progress = jobProgress(job, {
    viewer: side,
    otherFirst,
    rescheduled,
    workUnderway: helperProgress(job as unknown as Job, trackingStatus).workUnderway,
    tracking: trackingStatus ? { status: trackingStatus } : null,
    pendingApplicants,
  });
  if (progress.stage === null && !progress.next) return null;
  return (
    <div data-job-tracker="" className="rounded-2xl border border-border bg-card p-4 lg:border-0 lg:bg-transparent lg:p-0 lg:pt-1 lg:!shadow-none">
      <JobProgress progress={hideNext ? { ...progress, next: "" } : progress} />
    </div>
  );
}

/** How the poster's money stands, from payment_status. Unlisted states print nothing rather than a guess. */
const HELD_LINE: Partial<Record<string, string>> = {
  escrow: "Paid when you posted. Louisiana Helpr holds it until the job is done.",
  // Q2399: the card is held (or, far out, only saved) at posting and charged at the hire.
  held: "Your card isn't charged until a Helpr accepts your offer.",
  unpaid: "Not paid yet. Helprs can't see this job until it's paid.",
  abandoned: "Not paid yet. Helprs can't see this job until it's paid.",
  refunded: "Refunded to your card.",
  released: "Paid out to your Helpr.",
};


/** "Sat, Oct 31 at 11:13 PM" in Louisiana time (the payout schedule is Louisiana's). */
function payoutWhen(iso: string): string {
  const d = new Date(iso);
  const day = d.toLocaleDateString("en-US", { timeZone: "America/Chicago", weekday: "short", month: "short", day: "numeric" });
  const time = d.toLocaleTimeString("en-US", { timeZone: "America/Chicago", hour: "numeric", minute: "2-digit" });
  return `${day} at ${time}`;
}

/**
 * The poster's money once they approved (audit 2026-10-28 F32: a finished, released job still read "Your budget
 * $40" with no line at all, because payout_pending had none): that it was paid and released, when the Helpr's pay
 * goes out (jobs.payout_scheduled_at, the release's own schedule), and where the receipt is.
 */
const RELEASED = new Set(["payout_pending", "released"]);
function releasedLine(job: JobPageRow): string {
  if (job.payment_status === "released") return HELD_LINE.released!;
  const at = job.payout_scheduled_at && new Date(job.payout_scheduled_at).getTime() > Date.now() ? job.payout_scheduled_at : null;
  return at ? `Paid and released to your Helpr. Their pay goes out ${payoutWhen(at)}.` : "Paid and released to your Helpr. Their pay goes out with the next payout.";
}

/** The small word under the poster's amount in the header (owner 2026-11-01: the budget has no box of its own). */
const SHORT_STATUS: Partial<Record<string, string>> = {
  escrow: "Paid · held",
  held: "Card held",
  unpaid: "Not paid yet",
  abandoned: "Not paid yet",
  refunded: "Refunded",
  released: "Released",
  payout_pending: "Released",
};

/** The poster's amount, on the RIGHT of the page header (owner 2026-11-01), with its paid or held word under it. */
export function PosterPrice({ job }: { job: JobPageRow }) {
  const word = SHORT_STATUS[job.payment_status ?? ""];
  return (
    <div data-poster-money="" className="shrink-0 text-right">
      <p className={`text-ds-28 font-bold tabular-nums leading-none ${MONEY}`}>${formatPrice(job.budget)}</p>
      {word && <p data-poster-money-status="" className="mt-1 text-ds-12 font-semibold text-muted-foreground">{word}</p>}
    </div>
  );
}

/**
 * What the old budget card said that a word cannot (no box, under the header): the release and when the pay goes out,
 * why an unpaid job is not live, the receipt, and the applicant count. The "held" line is the header's word now.
 */
export function PosterMoneyNotes({ job, total, loading }: { job: JobPageRow; total: number; loading: boolean }) {
  const released = RELEASED.has(job.payment_status ?? "");
  const status = job.payment_status ?? "";
  // "Paid … holds it" is the header's "Paid · held"; every other state keeps its sentence.
  const line = released ? releasedLine(job) : status === "escrow" ? null : HELD_LINE[status] ?? null;
  const count = job.status === "open" && !loading && total > 0;
  if (!line && !released && !count) return null;
  return (
    <div data-poster-money-notes="" className="space-y-1.5">
      {line && <p className="text-ds-13 text-muted-foreground">{line}</p>}
      {released && (
        <Link data-receipt-link="" to="/profile?tab=receipts" className="inline-block text-ds-14 font-semibold text-primary underline underline-offset-2">
          See your receipt
        </Link>
      )}
      {/* Zero applicants is the page's own "No applicants yet" block (board 57), not a line here. */}
      {count && <p data-applicant-count="" className="text-ds-14 font-semibold">{`${total} applicant${total === 1 ? "" : "s"}`}</p>}
    </div>
  );
}

/** The Helpr's take-home and the words that go with it (one computation: takeHomeOneComputation.test.ts). */
function useHelprMoney(job: JobPageRow) {
  const firstPayoutFee = useFirstPayoutFeeDollars();
  const { profile } = useCurrentUser();
  // Split only on a group job (helperShareCount; helpersNeededSplitIsGroupGated).
  const helpers = helperShareCount(job);
  // A fee-stamped job pays by its stamp; an older unstamped job is
  // charged the viewer's own tier rate at payout, the same rate the feed's
  // "You earn" figure uses (useDashboardData: tierFeePercent of the profile).
  const tierPct = tierFeePercent(profile?.subscription_tier, profile?.subscription_expires_at);
  const net = computeNet(job.budget, tierPct, job.urgent_fee ?? 0, helpers, job.status === "disputed" ? 0 : firstPayoutFee, job).netEarnings;
  // Owner 2026-10-30: the giveaway shows its $50 with no words and no setup-fee line.
  const fixedPay = isGiveawayFixedPayJob(job);
  // Owner 2026-10-25: members never see the Helpr fee, its rate or its maths,
  // only the take-home (and the one-time setup fee on the payout it comes out of).
  const lines = [
    helpers > 1 ? `Your share of a job for ${helpers} Helprs.` : null,
    firstPayoutFee > 0 && job.status !== "disputed" && !fixedPay ? setupFeeWords(firstPayoutFee) : null,
  ].filter(Boolean) as string[];
  return { net, fixedPay, lines };
}

/** The Helpr's amount, on the RIGHT of the page header like the poster's (owner 2026-11-01), "You take home" under it. */
export function HelprPrice({ job }: { job: JobPageRow }) {
  const { net, fixedPay } = useHelprMoney(job);
  return (
    <div data-helpr-money="" className="shrink-0 text-right">
      <p className={`text-ds-28 font-bold tabular-nums leading-none ${MONEY}`}>${formatPriceFloor(net)}</p>
      {!fixedPay && <p className="mt-1 text-ds-12 font-semibold text-muted-foreground">You take home</p>}
    </div>
  );
}

/**
 * Under the header: a crew share and the one-time setup fee; and for the hired Helpr of a finished, approved job, that
 * it is paid and when the pay goes out (JA-22, Jobs audit 11-01: the poster's page said it, the Helpr's did not).
 */
export function HelprMoneyNotes({ job, hired }: { job: JobPageRow; hired: boolean }) {
  const { lines } = useHelprMoney(job);
  const approved = hired && RELEASED.has(job.payment_status ?? "");
  const at = approved && job.payout_scheduled_at && new Date(job.payout_scheduled_at).getTime() > Date.now() ? job.payout_scheduled_at : null;
  const paid = !approved ? null
    : job.payment_status === "released" ? "Approved and paid out to you."
    : at ? `Approved. Your pay goes out ${payoutWhen(at)}.` : "Approved. Your pay goes out with the next payout.";
  if (!paid && lines.length === 0) return null;
  return (
    <div data-helpr-money-notes="" className="space-y-1.5">
      {paid && <p data-helpr-paid="" className="text-ds-14 font-semibold text-foreground">{paid}</p>}
      {lines.length > 0 && <p className="text-ds-13 text-muted-foreground">{lines.join(" ")}</p>}
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

/**
 * AUD31-80: the poster's page never named the hired Helpr (PostedBy is the Helpr's view of the poster). The poster now
 * sees the same person card for their Helpr; "Message <name>" is already the page's own button (posterPageActions).
 */
export function HiredHelpr({ helprId }: { helprId: string }) {
  return (
    <section aria-label="Your Helpr">
      <DeclutterSellerCard sellerId={helprId} noun="Helpr" />
    </section>
  );
}
