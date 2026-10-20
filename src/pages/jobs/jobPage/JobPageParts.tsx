/**
 * The job page's pieces (boards 15, 42, 168, 169): the four-step tracker, the
 * poster's money card, the Helpr's take-home card and the "posted by" card.
 * Rust is money only (spec §1.1); every figure comes from the job row or the
 * real fee rule, or it is not shown (§1.5).
 */
import { formatPrice, formatPriceFloor } from "@/lib/format";
import { computeNet } from "@/components/dashboard/JobPrice";
import { useFirstPayoutFeeDollars } from "@/hooks/useFirstPayoutFee";
import { flatFeePercentOf, helprPaysNoFee, isFlatFeeJob } from "@/lib/helprFlatFee";
import { TIER_PERKS } from "@/lib/subscriptionTiers";
import { DeclutterSellerCard } from "@/components/declutter/DeclutterSellerCard";
import type { JobPageRow } from "./useJobPage";

const CARD = "rounded-2xl border border-border bg-card p-4 lg:border-0 lg:p-0 lg:rounded-none lg:bg-transparent lg:!shadow-none";
const MONEY = "text-[hsl(var(--burnt-sienna))]";

const STEPS = [
  { status: "open", label: "Posted" },
  { status: "accepted", label: "Hired" },
  { status: "in_progress", label: "Working" },
  { status: "completed", label: "Done" },
] as const;

/** What comes next, per side, in plain words. Only the four live steps have one. */
const NEXT: Record<"poster" | "helpr", Partial<Record<string, string>>> = {
  poster: {
    open: "Next: pick your Helpr.",
    accepted: "Next: your Helpr starts the job.",
    in_progress: "Next: check the work and release the pay.",
  },
  helpr: {
    accepted: "Next: start the job on the day.",
    in_progress: "Next: mark the job done.",
  },
};

/** Statuses off the four-step path say what happened instead of drawing a tracker. */
const OFF_PATH: Record<string, string> = {
  cancelled: "This job was cancelled.",
  disputed: "This job is being reviewed. We'll message you both.",
};

export function JobTracker({ status, side }: { status: string | null; side: "poster" | "helpr" | null }) {
  const s = status ?? "";
  if (OFF_PATH[s]) {
    return <p data-job-state="" className="rounded-xl bg-muted px-3 py-2 text-ds-14 font-medium">{OFF_PATH[s]}</p>;
  }
  const at = STEPS.findIndex((x) => x.status === s);
  // A Helpr browsing an open job is not on the job yet: no tracker for them.
  if (at < 0 || !side) return null;
  const next = NEXT[side][s];
  return (
    <div data-job-tracker="" className="rounded-2xl border border-border bg-card p-4 lg:border-0 lg:bg-transparent lg:p-0 lg:pt-1 lg:!shadow-none">
      <ol className="grid grid-cols-4 gap-1.5" aria-label={`Step ${at + 1} of 4: ${STEPS[at].label}`}>
        {STEPS.map((step, i) => (
          <li key={step.status} className="min-w-0">
            <span aria-hidden className={`block h-1 rounded-full ${i <= at ? "bg-primary" : "bg-muted"}`} />
            <span className={`mt-1.5 block truncate text-ds-12 ${i === at ? "font-semibold text-foreground" : "text-muted-foreground"}`}>
              {step.label}
            </span>
          </li>
        ))}
      </ol>
      {next && <p className="mt-2 text-ds-14 text-muted-foreground">{next}</p>}
    </div>
  );
}

/** How the poster's money stands, from payment_status. Unlisted states print nothing rather than a guess. */
const HELD_LINE: Partial<Record<string, string>> = {
  escrow: "Paid when you posted. We hold it until the job is done.",
  unpaid: "Not paid yet. Helprs can't see this job until it's paid.",
  abandoned: "Not paid yet. Helprs can't see this job until it's paid.",
  refunded: "Refunded to your card.",
  released: "Paid out to your Helpr.",
};

export function PosterMoney({ job, total, loading }: { job: JobPageRow; total: number; loading: boolean }) {
  const line = HELD_LINE[job.payment_status ?? ""];
  return (
    <div data-poster-money="" className={`${CARD} lg:border-t lg:!border-border lg:pt-4`}>
      <div className="flex items-baseline justify-between gap-3">
        <p className="text-ds-15 font-semibold">Your budget</p>
        <p className={`text-ds-28 font-bold tabular-nums leading-none ${MONEY}`}>${formatPrice(job.budget)}</p>
      </div>
      {line && <p className="mt-1.5 text-ds-13 text-muted-foreground">{line}</p>}
      {job.status === "open" && !loading && (
        <p data-applicant-count="" className="mt-3 border-t border-border pt-3 text-ds-14 font-semibold">
          {total === 0 ? "No applicants yet" : `${total} applicant${total === 1 ? "" : "s"}`}
        </p>
      )}
    </div>
  );
}

export function HelprMoney({ job }: { job: JobPageRow }) {
  const owed = useFirstPayoutFeeDollars();
  const helpers = job.helpers_needed && job.helpers_needed > 0 ? job.helpers_needed : 1;
  const flat = isFlatFeeJob(job);
  const keepsAll = helprPaysNoFee(job);
  // The take-home is shown only where the job carries its fee stamp: an
  // unstamped (older) job is priced by the viewer's own tier at payout, which
  // this page does not know, so it shows the job price instead.
  const net = flat ? computeNet(job.budget, TIER_PERKS.free.platformFeePercent, job.urgent_fee ?? 0, helpers, job.status === "disputed" ? 0 : owed, job).netEarnings : null;
  const pct = flatFeePercentOf(job);
  const flatCents = Number(job.helper_fee_flat_cents ?? 0);
  const feeLine = !flat
    ? null
    : keepsAll
      ? "You keep the whole price."
      : `Helpr's fee (${pct}% + ${flatCents}¢) comes out of your payout.`;
  return (
    <div data-helpr-money="" className={`${CARD} lg:border-t lg:!border-border lg:pt-4`}>
      <div className="flex items-baseline justify-between gap-3">
        <p className="text-ds-15 font-semibold">{net !== null ? "You take home" : helpers > 1 ? "Job price, split" : "Job price"}</p>
        <p className={`text-ds-28 font-bold tabular-nums leading-none ${MONEY}`}>
          ${net !== null ? formatPriceFloor(net) : formatPrice(job.budget / helpers)}
        </p>
      </div>
      {(net !== null || helpers > 1) && (
        <p className="mt-1.5 text-ds-13 text-muted-foreground">
          {[`$${formatPrice(job.budget)} job${helpers > 1 ? ` for ${helpers} Helprs` : ""}`, feeLine].filter(Boolean).join(" · ")}
          {net !== null && owed > 0 && job.status !== "disputed" ? ` After the one-time $${formatPrice(owed)} setup fee, taken from your first payout.` : ""}
        </p>
      )}
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
