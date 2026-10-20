import { useQuery } from "@tanstack/react-query";
import { Lock } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { unwrap } from "@/lib/supabaseResult";
import { formatPriceExact } from "@/lib/format";
import { STANDARD_PAYOUT_WINDOW } from "@/lib/payoutTiming";
import { useProofPhotoUrls, PENDING_PHOTO_SRC } from "@/hooks/useProofPhotoUrls";

/**
 * The top of the Job done screen (boards 35 poster / 36 Helpr), under the
 * "Job done" moment title: the job and the other person, the before/after
 * proof photos when the Helpr added them, and the money note for this side.
 *
 * TRUTH RULE (HELPR-DESIGN-SPEC §1.5): every figure is read, never derived.
 *  - Poster: the job price (`jobs.budget`) and the fact that escrow was
 *    released, shown only when `payment_status` says it was. The poster never
 *    sees the Helpr's take-home (owner 2026-10-20 05:35Z; the board's
 *    "You paid $103.04" line is dropped because no single stamped column says
 *    what the card was charged on every fee model).
 *  - Helpr: the amount actually transferred (`payout_transfers.amount_cents`,
 *    the Helpr's own rows), so the one-time setup fee and the whole-dollar
 *    floor are already in it. Before a transfer row exists the headline says
 *    the pay is on its way WITHOUT a number. "In your bank" is never lit: no
 *    per-job bank-arrival state exists; the caption gives the real window.
 *    Arrival date and bank last-4 from the board are omitted for the same
 *    reason (not stored per job).
 */

type Side = "poster" | "helper";

const RELEASED = new Set(["released", "payout_pending"]);

const MONEY = "hsl(var(--burnt-sienna))";
const MONEY_TINT = "hsl(var(--burnt-sienna) / 0.08)";

interface JobDoneRow {
  title: string;
  budget: number | null;
  status: string;
  payment_status: string | null;
  is_group_job: boolean | null;
  proof_before_urls: string[] | null;
  proof_after_urls: string[] | null;
}

interface TransferRow {
  amount_cents: number;
  status: string;
  metadata: unknown;
}

/** What the Helpr kept from this job's transfers, in cents, and whether all were sent. */
function transferredCents(rows: readonly TransferRow[]): { cents: number; allSent: boolean } {
  let cents = 0;
  let allSent = true;
  for (const t of rows) {
    if (t.status === "failed" || t.status === "canceled") continue;
    const reversed = t.status === "reversed"
      ? Math.max(0, Number((t.metadata as { amount_reversed_cents?: number } | null)?.amount_reversed_cents ?? t.amount_cents ?? 0))
      : 0;
    cents += Math.max(0, Number(t.amount_cents ?? 0) - reversed);
    if (t.status !== "paid") allSent = false;
  }
  return { cents, allSent };
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
  const { data: job } = useQuery({
    queryKey: ["job-done-summary", jobId],
    queryFn: async () =>
      unwrap(
        await supabase
          .from("jobs")
          .select("title, budget, status, payment_status, is_group_job, proof_before_urls, proof_after_urls")
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
  ].filter(Boolean) as { label: string; src: string | undefined }[];

  return (
    <div className="space-y-3 min-w-0">
      <p className="font-sans text-ds-14" style={{ color: "hsl(var(--olivewood) / 0.8)" }}>
        {side === "poster" ? `${job.title} · ${otherName}` : `${job.title} · for ${otherName}`}
      </p>

      {photos.length > 0 && (
        <div className={`grid gap-2 ${photos.length === 2 ? "grid-cols-2" : "grid-cols-1"}`}>
          {photos.map((p) => (
            <div key={p.label} className="relative aspect-[16/10] rounded-ds-lg overflow-hidden" style={{ background: "hsl(var(--muted))" }}>
              <img
                src={p.src ?? PENDING_PHOTO_SRC}
                alt={`${p.label} photo of ${job.title}`}
                className="w-full h-full object-cover"
                loading="lazy"
              />
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

      {side === "poster" && released && (
        <div className="rounded-ds-lg px-4 py-3" style={{ background: MONEY_TINT }}>
          <div className="flex items-center justify-between gap-3">
            <p className="font-sans font-bold text-ds-15 flex items-center gap-1.5" style={{ color: MONEY }}>
              <Lock className="w-4 h-4 shrink-0" aria-hidden="true" />
              {job.is_group_job ? "Released to your crew" : `Released to ${firstName}`}
            </p>
            {job.budget != null && (
              <p className="font-sans font-bold text-ds-18 tabular-nums" style={{ color: MONEY }}>
                ${formatPriceExact(job.budget)}
              </p>
            )}
          </div>
          <p className="font-sans text-ds-12 mt-0.5" style={{ color: MONEY }}>
            The job price is out of escrow and on its way.
          </p>
        </div>
      )}

      {side === "helper" && released && (
        <HelprPayNote transfers={transfers ?? []} posterFirstName={firstName} />
      )}
    </div>
  );
}

function HelprPayNote({ transfers, posterFirstName }: { transfers: readonly TransferRow[]; posterFirstName: string }) {
  const { cents, allSent } = transferredCents(transfers);
  const sent = cents > 0 && allSent;
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
      <p className="font-sans font-bold text-ds-24 leading-tight tabular-nums" style={{ color: MONEY }}>
        {cents > 0
          ? `$${formatPriceExact(cents / 100)} ${sent ? "was sent" : "is on its way"}`
          : "Your pay is on its way"}
      </p>
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
