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
import { NextStep } from "@/components/ui/NextStep";
import { isExpiredListing } from "@/lib/expiredListing";
import { jobNextStep } from "@/components/tracker/jobNextStep";

/** The "What to fix" card (RevisionAsk): a card on a phone, flat inside the desktop side column. */
const CARD = "rounded-2xl border border-border bg-card p-4 lg:border-0 lg:p-0 lg:rounded-none lg:bg-transparent lg:!shadow-none";
const MONEY = "text-[hsl(var(--burnt-sienna))]";

/**
 * The job page's tracker is THE one tracker (owner, 2026-10-21): the same four segments and next line as
 * chat and the job cards (jobProgress). A Helpr browsing an open job is not on it yet: no tracker for them.
 */
export function JobTracker({ job, side, trackingStatus = null, pendingApplicants, otherFirst = null, hideNext = false, crewMember, offerOut = false, noShowRepostedOn = null, approveLeft = null }: {
  job: JobPageRow; side: "poster" | "helpr" | null; trackingStatus?: string | null; pendingApplicants?: number;
  /** The poster's offer or booking is out (JA-48 / JA-49): the line waits on that Helpr, never "Helprs to apply". */
  offerOut?: boolean;
  /** JA-27: the day a no-show put this job back up ("Sat, Nov 1"), for the poster's line. */
  noShowRepostedOn?: string | null;
  /** The poster's review window in words ("23h 52m left, then Helpr support steps in"), in the line itself. */
  approveLeft?: string | null;
  /** The page says the step above the tracker (OnTheWayNow): the tracker draws its bar without repeating the line. */
  hideNext?: boolean;
  /** The viewer is on this crew's roster (JA-33): whether they confirmed their spot. Undefined = not a crew member. */
  crewMember?: { confirmed: boolean };
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
    crewMember,
  });
  if (progress.stage === null && !progress.next) return null;
  // THE STATUS LINE IS THE NEXT STEP (owner 11-01 12:05 PM): what to do or who we wait on, with its deadline, ABOVE the
  // bar (mockups 4 and 5); the bar draws no line of its own under it. Off the path the tracker keeps its own words.
  const step = hideNext ? null : jobNextStep(progress, { side, otherFirst, pendingApplicants, offerOut, noShowRepostedOn, approveLeft });
  return (
    <div data-job-tracker="" className="space-y-3">
      {step && <NextStep value={step} />}
      <JobProgress progress={step || hideNext ? { ...progress, next: "" } : progress} />
    </div>
  );
}

/** How the poster's money stands, from payment_status. Unlisted states print nothing rather than a guess. */
const HELD_LINE: Partial<Record<string, string>> = {
  // True with and without the card hold at posting (charged at post, or at the hire): never "when you posted" (F4).
  escrow: "Paid. Louisiana Helpr holds it until the job is done.",
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

/**
 * The poster's amount. Phone: on the RIGHT of the title block (mockup 5). Computer: "Job price" on the left of the
 * side card, the amount on its right (mockup 4). The paid or held words are ONE sentence under it (PosterMoneyNotes),
 * from payment_status alone (JA-47: "Paid · held" beside "card held, not charged" said two things about one payment).
 */
export function PosterPrice({ job, labelled = false }: { job: JobPageRow; labelled?: boolean }) {
  const amount = <p className={`text-ds-28 font-bold tabular-nums leading-none ${MONEY}`}>${formatPrice(job.budget)}</p>;
  if (labelled) {
    return (
      <div data-poster-money="" className="flex items-baseline justify-between gap-3">
        <p className="text-ds-16 font-semibold">Job price</p>
        {amount}
      </div>
    );
  }
  return <div data-poster-money="" className="shrink-0 text-right">{amount}</div>;
}

/**
 * What the old budget card said that a word cannot (no box, under the header): the release and when the pay goes out,
 * why an unpaid job is not live, the receipt, and the applicant count. The "held" line is the header's word now.
 */
export function PosterMoneyNotes({ job, total, loading }: { job: JobPageRow; total: number; loading: boolean }) {
  const released = RELEASED.has(job.payment_status ?? "");
  const status = job.payment_status ?? "";
  // ONE sentence about the money, from payment_status alone (JA-47), "Paid. Louisiana Helpr holds it…" included.
  // Lead 11-01 (B107): a cancelled job's tracker line already says "... · Your payment was refunded" (JA-26,
  // jobProgressState cancelledLine), so the refund is said ONCE, there. An expired listing's line says only "No
  // Helpr was hired in time", so it keeps "Refunded to your card." here. Guard: src/test/refundSaidOnce.test.tsx.
  const refundInTracker = status === "refunded" && (job.status === "cancelled" || job.status === "expired") && !isExpiredListing(job);
  const line = released ? releasedLine(job) : refundInTracker ? null : HELD_LINE[status] ?? null;
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

/**
 * What a Helpr reads instead of a take-home when there is nothing to take home (audit 11-01 JA-24): a cancelled job,
 * or one where they were reported a no-show, pays them nothing (JOBS-3: a no-show member gets nothing), except a
 * poster's late cancel, whose fee is shared with them (poster_cancel_job: cancellation_fee > 0). Null = the normal box.
 * Guard: src/test/helprMoneyNotOnACancelledJob.test.tsx.
 */
function helprNoPayWords(job: Pick<JobPageRow, "status" | "cancellation_fee" | "cancelled_by" | "customer_id">, noShow = false): { title: string; line: string } | null {
  if (noShow) return { title: "Not paid", line: "You were reported as a no-show, so you aren't paid for this job." };
  if (job.status !== "cancelled") return null;
  if (Number(job.cancellation_fee ?? 0) > 0 && !!job.cancelled_by && job.cancelled_by === job.customer_id) {
    return { title: "Cancelled late", line: "It was cancelled close to the start, so you get a share of the late-cancel fee." };
  }
  return { title: "Not paid", line: "This job was cancelled, so there's nothing to pay out." };
}

/** The Helpr's take-home and the words that go with it (one computation: takeHomeOneComputation.test.ts). */
function useHelprMoney(job: JobPageRow, noShow = false) {
  const noPay = helprNoPayWords(job, noShow);
  // JA-29: during a dispute the money is held, not theirs yet.
  const disputed = job.status === "disputed" || !!job.has_active_dispute;
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
    firstPayoutFee > 0 && !disputed && !fixedPay ? setupFeeWords(firstPayoutFee) : null,
  ].filter(Boolean) as string[];
  return { net, fixedPay, lines, noPay, disputed };
}

/**
 * The Helpr's amount, on the RIGHT of the page header like the poster's (owner 2026-11-01), "You take home" under it.
 * Nothing to take home (JA-24): the word ("Not paid", "Cancelled late") and no figure. A dispute (JA-29): the amount
 * with "On hold while we review" under it, never a certain take-home.
 */
export function HelprPrice({ job, noShow = false }: { job: JobPageRow; noShow?: boolean }) {
  const { net, fixedPay, noPay, disputed } = useHelprMoney(job, noShow);
  if (noPay) {
    return (
      <div data-helpr-money="" data-helpr-no-pay="" className="shrink-0 text-right">
        <p className="text-ds-16 font-bold leading-none">{noPay.title}</p>
      </div>
    );
  }
  return (
    <div data-helpr-money="" className="shrink-0 text-right">
      <p className={`text-ds-28 font-bold tabular-nums leading-none ${MONEY}`}>${formatPriceFloor(net)}</p>
      {disputed ? <p data-helpr-money-held="" className="mt-1 text-ds-12 font-semibold text-muted-foreground">On hold while we review</p>
        : !fixedPay && <p className="mt-1 text-ds-12 font-semibold text-muted-foreground">You take home</p>}
    </div>
  );
}

/**
 * Under the header: a crew share and the one-time setup fee; and for the hired Helpr of a finished, approved job, that
 * it is paid and when the pay goes out (JA-22, Jobs audit 11-01: the poster's page said it, the Helpr's did not).
 * A job that pays them nothing says why (JA-24) and nothing else; a held one never says it is paid.
 */
export function HelprMoneyNotes({ job, hired, noShow = false }: { job: JobPageRow; hired: boolean; noShow?: boolean }) {
  const { lines, noPay, disputed } = useHelprMoney(job, noShow);
  if (noPay) {
    return (
      <div data-helpr-money-notes="" className="space-y-1.5">
        <p className="text-ds-13 text-muted-foreground">{noPay.line}</p>
      </div>
    );
  }
  const approved = hired && !disputed && RELEASED.has(job.payment_status ?? "");
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

/**
 * WHAT TO FIX, ON THE PAGE (audit 11-01 JA-31): a job sent back for a fix said "Dana asked for a fix" and never what or
 * by when; the Helpr had to open the Working card. The poster's own words (revision_note) and the fix deadline
 * (revision_deadline, Louisiana time) show here for both parties while the fix is open. Nothing when neither is set.
 * Guard: src/test/revisionNoteOnJobPage.test.tsx.
 */
export function RevisionAsk({ job, side, posterFirst }: { job: JobPageRow; side: "poster" | "helpr"; posterFirst?: string | null }) {
  if (job.status !== "revision_requested") return null;
  const note = (job.revision_note ?? "").trim();
  const dueMs = Date.parse(job.revision_deadline ?? "");
  if (!note && Number.isNaN(dueMs)) return null;
  const due = Number.isNaN(dueMs) ? null : new Date(dueMs).toLocaleString("en-US", { timeZone: "America/Chicago", weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
  const whose = side === "poster" ? "Your note" : posterFirst?.trim() ? `${posterFirst.trim()}'s note` : "Their note";
  return (
    <section aria-label="What to fix" data-revision-ask="" className={CARD}>
      <p className="text-ds-15 font-semibold">What to fix</p>
      {note && <p className="mt-1.5 whitespace-pre-line text-ds-14 [overflow-wrap:anywhere]"><span className="font-semibold">{whose}: </span>{note}</p>}
      {due && <p className="mt-1.5 text-ds-13 text-muted-foreground">{side === "poster" ? "The fix is due by" : "Send the fix by"} {due}.</p>}
    </section>
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
