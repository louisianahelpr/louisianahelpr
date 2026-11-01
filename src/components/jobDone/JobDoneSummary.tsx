import { useQuery } from "@tanstack/react-query";
import { usePayoutSetupPaused } from "@/hooks/usePayoutSetupPaused";
import { PayoutSetupPausedNotice } from "@/components/payouts/PayoutSetupPausedNotice";
import { Check } from "lucide-react";
import { Link } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { unwrap } from "@/lib/supabaseResult";
import { formatPriceExact } from "@/lib/format";
import { STANDARD_PAYOUT_WINDOW } from "@/lib/payoutTiming";
import { useProofPhotoUrls } from "@/hooks/useProofPhotoUrls";
import { ProofPhotoImg } from "@/components/ProofPhotoImg";
import { queryKeys } from "@/lib/queryKeys";
import { fetchPayoutStatus, payoutStatusQueryOptions } from "@/lib/payoutSetupQueries";
import { transferredCents, type TransferRow } from "@/lib/jobDonePay";
import { useAgeGate } from "@/hooks/useAgeGate";
import { bookAgainLabel, bookAgainLink } from "@/lib/bookAgain";
import SaveHelperButton from "@/components/SaveHelperButton";

/**
 * The top of the Job done screen (boards 35 poster / 36 Helpr), under the
 * "Job done" moment title: the job and the other person, the before/after
 * proof photos when the Helpr added them, and the money note for this side.
 *
 * TRUTH RULE (HELPR-DESIGN-SPEC §1.5): every figure is read, never derived,
 * reviewed by lh-money-escrow 2026-10-20 (two changes-needed rounds, all
 * findings fixed; third round: approve).
 *  - Poster: the job price (`jobs.budget`, labelled "Job price") on an
 *    undisputed single-Helpr job; "Paid to X" only at payment_status
 *    'released', "Approved" + the real payout_scheduled_at at
 *    'payout_pending'. The poster never sees the Helpr's take-home (owner
 *    2026-10-20 05:35Z) or what the card was charged.
 *  - Helpr: the headline amount is the transfer itself
 *    (`payout_transfers.amount_cents`, own rows, clawbacks removed). Before a
 *    transfer exists there is no number at all (no fee line either). "In your bank" is never lit: no per-job bank-arrival
 *    state exists; the caption gives the real window. The board's arrival
 *    date and bank last-4 are omitted for the same reason.
 */

type Side = "poster" | "helper";

const RELEASED = new Set(["released", "payout_pending"]);

const MONEY = "hsl(var(--burnt-sienna))";
const MONEY_TINT = "hsl(var(--burnt-sienna) / 0.08)";

interface JobDoneRow {
  title: string;
  helper_id: string | null;
  budget: number | null;
  status: string;
  payment_status: string | null;
  is_group_job: boolean | null;
  helpers_needed: number | null;
  urgent_fee: number | null;
  helper_fee_flat_cents: number | null;
  helper_fee_percent: number | null;
  platform_fee_amount: number | null;
  disputed_at: string | null;
  dispute_status: string | null;
  payout_scheduled_at: string | null;
  proof_before_urls: string[] | null;
  proof_after_urls: string[] | null;
}


export function JobDoneSummary({
  jobId,
  side,
  otherName,
  viewerId,
}: {
  jobId: string;
  side: Side;
  /** The other person's display name ("Andre L."). */
  otherName: string;
  viewerId: string;
}) {
  // Q1586(c): "Hire again" opens Post a Job, so it is greyed out under 18.
  const { underAge, explain, gatedProps } = useAgeGate();
  const { data: job } = useQuery({
    queryKey: ["job-done-summary", jobId],
    queryFn: async () =>
      unwrap(
        await supabase
          .from("jobs")
          .select("title, helper_id, budget, status, payment_status, is_group_job, helpers_needed, urgent_fee, helper_fee_flat_cents, helper_fee_percent, platform_fee_amount, disputed_at, dispute_status, payout_scheduled_at, proof_before_urls, proof_after_urls")
          .eq("id", jobId)
          .maybeSingle(),
      ) as JobDoneRow | null,
    staleTime: 30_000,
  });

  const { data: transfers } = useQuery({
    queryKey: ["job-done-transfers", jobId, viewerId],
    queryFn: async () =>
      unwrap(
        await supabase
          .from("payout_transfers")
          .select("amount_cents, status, metadata")
          .eq("job_id", jobId)
          .eq("helper_id", viewerId),
      ) as TransferRow[],
    enabled: side === "helper" && !!viewerId,
    staleTime: 30_000,
  });

  const before = job?.proof_before_urls?.[0] ?? "";
  const after = job?.proof_after_urls?.[0] ?? "";
  const [beforeSrc, afterSrc] = useProofPhotoUrls([before, after]);

  if (!job) return null;

  const released = job.status === "completed" && RELEASED.has(job.payment_status ?? "");
  const firstName = otherName.split(" ")[0] || otherName;
  const photos = [
    before ? { label: "Before", src: beforeSrc } : null,
    after ? { label: "After", src: afterSrc } : null,
  ].filter(Boolean) as { label: string; src: string | null | undefined }[];

  return (
    <div className="space-y-3 min-w-0">
      <p className="font-sans text-ds-14" style={{ color: "hsl(var(--olivewood) / 0.8)" }}>
        {side === "poster" ? `${job.title} · ${otherName}` : `${job.title} · for ${otherName}`}
      </p>

      {photos.length > 0 && (
        <div className={`grid gap-2 ${photos.length === 2 ? "grid-cols-2" : "grid-cols-1"}`}>
          {photos.map((p) => (
            <div key={p.label} className="relative aspect-[16/10] rounded-ds-lg overflow-hidden" style={{ background: "hsl(var(--photo-empty, 40 23% 82%))" }}>
              <ProofPhotoImg src={p.src} alt={`${p.label} photo of ${job.title}`} className="w-full h-full object-cover" />
              <span
                className="absolute top-2 left-2 px-2.5 py-0.5 rounded-full font-sans font-bold text-ds-11"
                style={{ background: "hsl(var(--card))", color: "hsl(var(--ink-deep))" }}
              >
                {p.label}
              </span>
            </div>
          ))}
        </div>
      )}

      {side === "poster" && released && !job.disputed_at && !job.dispute_status && (
        // Only an undisputed job: a dispute split or a crew refund pays out
        // less than the price, and showing what WAS paid would reveal the
        // Helpr's take-home (lh-money-escrow review, findings 3, 4, 6).
        <div className="rounded-ds-lg px-4 py-3" style={{ background: MONEY_TINT }}>
          <div className="flex items-center justify-between gap-3">
            <p className="font-sans font-bold text-ds-15 flex items-center gap-1.5" style={{ color: MONEY }}>
              <Check className="w-4 h-4 shrink-0" aria-hidden="true" />
              {job.payment_status === "released"
                ? (job.is_group_job ? "Paid to your crew" : `Paid to ${firstName}`)
                : "Approved"}
            </p>
            {job.budget != null && !job.is_group_job && (
              <p className="font-sans font-bold text-ds-18 tabular-nums text-right leading-tight" style={{ color: MONEY }}>
                ${formatPriceExact(job.budget)}
                <span className="block font-semibold text-ds-11">Job price</span>
              </p>
            )}
          </div>
          <p className="font-sans text-ds-12 mt-0.5" style={{ color: MONEY }}>
            {job.payment_status === "released"
              ? (job.is_group_job ? "It's on its way to their banks." : "It's on its way to their bank.")
              : job.payout_scheduled_at
                ? `${job.is_group_job ? "Your crew's" : `${firstName}'s`} pay is scheduled to go out ${formatPayoutTime(job.payout_scheduled_at)}.`
                : `${job.is_group_job ? "Your crew's" : `${firstName}'s`} pay goes out with the next payout.`}
          </p>
        </div>
      )}

      {side === "poster" && !job.is_group_job && job.helper_id && (
        // Board 185: hire the same Helpr again, for any job. A blank post
        // sent to this Helpr first as a direct offer (the saved-Helpr card's
        // path); owner 2026-10-25: not prefilled from this job, since the
        // next job may be something else.
        <div className="rounded-ds-lg p-4 flex flex-wrap items-center gap-x-3 gap-y-3" style={{ background: "hsl(var(--card))", boxShadow: "0 4px 18px rgba(32,30,26,0.06)" }}>
          <span
            aria-hidden="true"
            className="w-11 h-11 shrink-0 rounded-full flex items-center justify-center font-sans font-bold text-ds-14"
            style={{ background: "hsl(var(--photo-empty, 40 23% 82%))", color: "hsl(var(--ink-deep))" }}
          >
            {initials(otherName)}
          </span>
          <div className="flex-1 min-w-[60%]">
            <p className="font-sans font-bold text-ds-15" style={{ color: "hsl(var(--ink-deep))" }}>Hire {firstName} again?</p>
          </div>
          {/* Save this Helpr (Q2471 #3): the heart puts them on Your Helprs, which Post a job offers directly. */}
          <SaveHelperButton helperId={job.helper_id} customerId={viewerId} />
          {/* Book <Helpr> again (Q2471 #3, owner 2026-10-29): THIS job copied, never its date, as a direct
              offer to the same Helpr; Post a job opens at When and where, so only the date is asked. */}
          <div className="w-full pl-14 flex flex-wrap gap-2">
          <Link
            to={bookAgainLink(jobId, job.helper_id)}
            data-testid="book-again"
            aria-label={`${bookAgainLabel(otherName)} — the same job for ${otherName}, you pick the date`}
            {...gatedProps("post")}
            onClick={(e) => {
              if (!underAge) return;
              e.preventDefault();
              explain("post");
            }}
            // Secondary: "Send review" is this screen's one primary (spec §3).
            className="shrink-0 min-h-11 px-5 rounded-full inline-flex items-center font-sans font-bold text-ds-14"
            style={{ background: "hsl(var(--card))", color: "hsl(var(--ink-deep))", border: "1px solid hsl(var(--olivewood) / 0.22)" }}
          >
            {bookAgainLabel(otherName)}
          </Link>
          {/* ONE "again" button (audit 11-01 JA-53): "Hire again" (a blank post offered to the same Helpr) sat beside
              "Book <Helpr> again" and read the same. The blank route stays one tap away on Post a job's "Offer to a
              saved Helpr" (the heart above saves them). */}
          </div>
        </div>
      )}

      {side === "helper" && released && transfers && (
        <HelprPayNote
          transfers={transfers}
          held={job.dispute_status === "reversal_hold"}
          viewerId={viewerId}
          posterFirstName={firstName}
        />
      )}
    </div>
  );
}

function HelprPayNote({ transfers, held, viewerId, posterFirstName }: {
  transfers: readonly TransferRow[];
  /** A clawed-back transfer frozen for review (transferReversed). */
  held: boolean;
  viewerId: string;
  posterFirstName: string;
}) {
  // THE NUMBER IS THE TRANSFER. Before a transfer row exists no headline
  // amount is shown: account-level deductions (the one-time setup fee, a
  // Helpr-fault fee debt), a missing payout account or a freeze can all make
  // the transfer differ from the job's take-home (lh-money-escrow review,
  // findings 2, 5, 7). No fee breakdown line either: the fee is charged on the
  // urgent share too and on a dispute split's share, and the transfer is
  // floored and can carry the setup fee, so a "job · fee" line would not add
  // up to the headline (re-review findings 1-2).
  const { cents, sent } = transferredCents(transfers);
  // Nothing sent yet and no payout account: say what to do (re-review #3).
  const { data: payout } = useQuery({
    queryKey: queryKeys.payoutSetup.status(viewerId),
    queryFn: fetchPayoutStatus,
    ...payoutStatusQueryOptions,
    enabled: !!viewerId && transfers.length === 0,
  });
  const needsPayoutSetup = transfers.length === 0 && payout != null && !payout.payouts_enabled;
  // Owner ruling 2026-10-23: while payout setup is paused the "Set up payouts"
  // link gives way to the paused notice.
  const setupPaused = usePayoutSetupPaused();
  if (held || (transfers.length > 0 && cents === 0)) {
    return (
      <div className="rounded-ds-lg p-4 text-center" style={{ background: "hsl(var(--card))", boxShadow: "0 4px 18px rgba(32,30,26,0.06)" }}>
        <p className="font-sans font-bold text-ds-18" style={{ color: "hsl(var(--ink-deep))" }}>Your pay for this job is on hold</p>
        <p className="font-sans text-ds-13 mt-1" style={{ color: "hsl(var(--olivewood) / 0.8)" }}>
          Questions about it? <Link to="/help" className="font-bold" style={{ color: "hsl(var(--bark))" }}>Get help</Link>
        </p>
      </div>
    );
  }
  const steps = [
    { label: "Confirmed", done: true },
    { label: "Sent", done: sent },
    { label: "In your bank", done: false },
  ];
  return (
    <div
      className="rounded-ds-lg p-4 space-y-3 text-center"
      style={{ background: "hsl(var(--card))", boxShadow: "0 4px 18px rgba(32,30,26,0.06)" }}
    >
      <p className="font-sans font-bold text-ds-24 leading-tight tabular-nums" style={{ color: cents > 0 ? MONEY : "hsl(var(--ink-deep))" }}>
        {cents > 0
          ? `$${formatPriceExact(cents / 100)} ${sent ? "was sent" : "is on its way"}`
          : "Your pay is being prepared"}
      </p>
      {needsPayoutSetup && setupPaused && (
        <>
          <p className="font-sans text-ds-13" style={{ color: "hsl(var(--ink-deep))" }}>
            Your pay is kept for you. We'll let you know when you can add where to send it.
          </p>
          <PayoutSetupPausedNotice compact className="text-left" />
        </>
      )}
      {needsPayoutSetup && !setupPaused && (
        <p className="font-sans text-ds-13" style={{ color: "hsl(var(--ink-deep))" }}>
          {payout?.connected ? "Finish setting up payouts so it can be sent." : "Add a payout account so it can be sent."}{" "}
          <Link to="/profile?tab=payment" className="font-bold" style={{ color: "hsl(var(--bark))" }}>Set up payouts</Link>
        </p>
      )}
      <p className="font-sans text-ds-14" style={{ color: "hsl(var(--ink-deep))" }}>
        {/* Not "<name> confirmed": a job can also complete on the auto-release timer. */}
        The job with {posterFirstName} is confirmed.
      </p>
      <ol className="grid grid-cols-3 gap-2" aria-label="Payout progress">
        {steps.map((s) => (
          <li key={s.label} className="space-y-1">
            <span
              aria-hidden="true"
              className="block h-1 rounded-full"
              style={{ background: s.done ? "hsl(var(--bark))" : "hsl(var(--olivewood) / 0.15)" }}
            />
            <span
              className={`block font-sans text-ds-12 ${s.done ? "font-bold" : ""}`}
              style={{ color: s.done ? "hsl(var(--ink-deep))" : "hsl(var(--olivewood) / 0.7)" }}
            >
              {s.label}
              <span className="sr-only">{s.done ? " (done)" : " (not yet)"}</span>
            </span>
          </li>
        ))}
      </ol>
      <p className="font-sans text-ds-12" style={{ color: "hsl(var(--olivewood) / 0.8)" }}>
        Once it's sent, it reaches your bank {STANDARD_PAYOUT_WINDOW}.
      </p>
    </div>
  );
}

/** "Tue, Oct 21 at 3:00 PM" in the viewer's zone. */
function formatPayoutTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime()) || d.getTime() < Date.now()) return "with the next payout";
  return `on ${d.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" })} at ${d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })}`;
}

/** "Andre L." -> "AL". */
function initials(name: string): string {
  return name.trim().split(/\s+/).slice(0, 2).map((w) => w[0]?.toUpperCase() ?? "").join("");
}
