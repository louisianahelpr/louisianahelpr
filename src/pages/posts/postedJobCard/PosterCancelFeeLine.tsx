import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { report } from "@/lib/errorLogger";
import { formatPriceExact } from "@/lib/format";

/**
 * Q1916 (poster half): what the poster's cancelled-job card says about the fee they owed their Helpr.
 *
 * jobs.cancellation_fee_status 'charged' means the fee was TAKEN, not that a card paid it. On a gift-funded job
 * void-cancelled-payments keeps the fee out of the gift before giving the rest back (restore_gift_card_for_job,
 * 20261102071958: a 'sent' row with restored_from_job_id = the job), so "· charged" in red told the poster a card
 * was charged when the gift paid. What the gift kept is read from the poster's own gift rows (the
 * "Gift cards are party-only" SELECT policy; the same columns usePosterSpendData reads), exactly as the RPC
 * counts it: applied = credit - leftover children; kept = applied - the job's restore row.
 */
export type GiftRow = {
  id: string;
  amount: number | string | null;
  status: string | null;
  job_id: string | null;
  parent_credit_id: string | null;
  restored_from_job_id: string | null;
};

const cents = (v: number | string | null | undefined) => {
  const n = Number(v ?? 0);
  return Number.isFinite(n) ? Math.round(n * 100) : 0;
};

/** Cents of the gift spent on this job that it kept (null: no gift was spent on this job). */
export function giftKeptCents(jobId: string, rows: readonly GiftRow[]): number | null {
  const credit = rows.find((r) => r.job_id === jobId && r.status === "redeemed");
  if (!credit) return null;
  const leftover = rows
    .filter((r) => r.parent_credit_id === credit.id && r.restored_from_job_id == null)
    .reduce((s, r) => s + cents(r.amount), 0);
  const applied = Math.max(0, cents(credit.amount) - leftover);
  const restored = rows.filter((r) => r.restored_from_job_id === jobId).reduce((s, r) => s + cents(r.amount), 0);
  return Math.max(0, applied - restored);
}

export function posterCancelFeeLine(
  status: string,
  feeDollars: number,
  /** undefined: not read yet or unreadable; null: no gift was spent on this job. */
  keptCents: number | null | undefined,
): { label: string; cardCharged: boolean } {
  const feeAmt = `$${formatPriceExact(feeDollars)}`;
  if (status === "waived") return { label: "Nothing to your Helpr · waived", cardCharged: false };
  if (status === "pending") return { label: `${feeAmt} for your Helpr's time · pending`, cardCharged: false };
  if (status !== "charged") return { label: `${feeAmt} for your Helpr's time`, cardCharged: false };
  // Unread: the fee was taken, but by what is not known yet, so say neither "charged" nor "gift card".
  if (keptCents === undefined) return { label: `${feeAmt} for your Helpr's time · paid`, cardCharged: false };
  const feeCents = cents(feeDollars);
  const fromGift = Math.min(feeCents, Math.max(0, keptCents ?? 0));
  if (fromGift <= 0) return { label: `${feeAmt} for your Helpr's time · charged`, cardCharged: true };
  if (fromGift >= feeCents) return { label: `${feeAmt} for your Helpr's time · paid with your gift card`, cardCharged: false };
  const giftAmt = `$${formatPriceExact(fromGift / 100)}`;
  const cardAmt = `$${formatPriceExact((feeCents - fromGift) / 100)}`;
  return { label: `${feeAmt} for your Helpr's time · ${giftAmt} from your gift card, ${cardAmt} charged`, cardCharged: true };
}

export function PosterCancelFeeLine({
  jobId,
  fee,
  status,
  posterId,
}: {
  jobId: string;
  fee: number;
  status: string;
  posterId: string | null | undefined;
}) {
  const { data: rows = null } = useQuery({
    queryKey: ["poster-cancel-fee-gift", jobId, posterId],
    enabled: status === "charged" && !!posterId,
    staleTime: 60_000,
    queryFn: async (): Promise<GiftRow[] | null> => {
      const cols = "id, amount, status, job_id, parent_credit_id, restored_from_job_id";
      const { data: onJob, error } = await supabase
        .from("gift_cards")
        .select(cols)
        .eq("recipient_id", posterId as string)
        .or(`job_id.eq.${jobId},restored_from_job_id.eq.${jobId}`);
      if (error) {
        report(error, { severity: "warning", tags: { source: "PosterCancelFeeLine.gift" } });
        return null;
      }
      const credits = (onJob ?? []).filter((r) => r.job_id === jobId && r.status === "redeemed").map((r) => r.id);
      if (credits.length === 0) return (onJob ?? []) as GiftRow[];
      const { data: kids, error: kidsErr } = await supabase.from("gift_cards").select(cols).in("parent_credit_id", credits);
      if (kidsErr) {
        report(kidsErr, { severity: "warning", tags: { source: "PosterCancelFeeLine.giftLeftover" } });
        return null;
      }
      const byId = new Map<string, GiftRow>();
      for (const r of [...(onJob ?? []), ...(kids ?? [])] as GiftRow[]) byId.set(r.id, r);
      return [...byId.values()];
    },
  });
  const { label, cardCharged } = posterCancelFeeLine(status, fee, rows ? giftKeptCents(jobId, rows) : undefined);
  return (
    <p
      className="text-ds-11 font-medium tabular-nums"
      style={{ color: cardCharged ? "hsl(var(--destructive-ink))" : "hsl(var(--olivewood) / 0.85)" }}
    >
      {label}
    </p>
  );
}
