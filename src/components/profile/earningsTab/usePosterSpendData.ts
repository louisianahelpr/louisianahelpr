import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { readJobsAheadOfDb } from "@/lib/jobColumns";
import { unwrap } from "@/lib/supabaseResult";
import type { PosterBlockFeeRow, PosterGiftRow, PosterRefundRow, PosterSpendJob, PosterTipRow } from "@/lib/posterSpend";

/** Poster-side slice for the Spent card and its list. */
export interface SpentJobRow extends PosterSpendJob {
  title: string | null;
  /** The hired Helpr (Home's held tile names who it is paid to). */
  helper_id?: string | null;
  status: string;
  dispute_status: string | null;
  /** 0 on a job priced with no poster service fee (its fee IS the card cost); read by setupFeeReceiptNote. */
  platform_fee_percent: number | null;
  cancelled_at: string | null;
  poster_completed_at: string | null;
  helper_completed_at: string | null;
  created_at: string;
}

interface SpentData {
  jobs: SpentJobRow[];
  refunds: PosterRefundRow[];
  tips: PosterTipRow[];
  gifts: PosterGiftRow[];
  /** Crew block fees owed on the poster's own jobs (Q1736). */
  blockFees: PosterBlockFeeRow[];
}

/**
 * THE POSTER'S MONEY READS (moved here from SpentSection so Home's "Held for
 * you" tile reads the SAME rows, under the SAME key, as the Money tab's Spent
 * half): every job they posted with its charge columns, their payment_refunds
 * rows, their redeemed gift cards, the tips they paid and the crew block fees
 * on their jobs. posterSpend.ts decides what each one cost.
 */
export function usePosterSpendData(userId: string | undefined) {
  return useQuery<SpentData>({
    // The key names the shape: a cached row from an older select has no charge.
    queryKey: ["payment", "posterSpend", "charged", userId],
    queryFn: async () => {
      const posterId = userId!;
      const [jobs, refunds, gifts, tips, blockFees] = await Promise.all([
        // EVERY job this person posted, whatever its status: money held in
        // escrow on an open or in-progress job has left the card too, and a
        // cancellation can keep a fee (owner, 2026-10-05: "everything that
        // actually left the poster's card"). posterSpend decides which of
        // them cost anything. onboarding_fee_amount is ahead of db-deploy
        // (JOB_COLUMNS_AHEAD_OF_DB), so the read retries once without it.
        readJobsAheadOfDb(
          "id, title, status, helper_id, budget, customer_fee_amount, platform_fee_percent, urgent_fee, sales_tax_amount, onboarding_fee_amount, dispute_status, payment_status, stripe_payment_intent_id, cancellation_fee, cancellation_fee_status, poster_completed_at, helper_completed_at, cancelled_at, created_at",
          (columns) => supabase.from("jobs").select(columns).eq("customer_id", posterId),
        ),
        supabase.from("payment_refunds").select("job_id, amount_cents, stripe_payment_intent_id, source").eq("customer_id", posterId),
        supabase.from("gift_cards").select("job_id, amount").eq("recipient_id", posterId).eq("status", "redeemed"),
        // Tips this person PAID (tips RLS also shows tips they received).
        supabase.from("tips").select("id, job_id, amount, payment_status, stripe_payment_intent_id, created_at").eq("tipper_id", posterId),
        // Q1736: the crew block fees an uncaptured hold's capture took with the
        // cancellation fee. The ledger has no client grant, so a definer RPC
        // answers the poster's own jobs only.
        supabase.rpc("poster_crew_block_fee_cents"),
      ]);
      return {
        jobs: (unwrap(jobs) ?? []) as unknown as SpentJobRow[],
        refunds: (unwrap(refunds) ?? []) as PosterRefundRow[],
        gifts: (unwrap(gifts) ?? []) as PosterGiftRow[],
        tips: (unwrap(tips) ?? []) as PosterTipRow[],
        // Deployed before its migration (functions and db deploy separately):
        // no rows, the Spent figure as it was. Any other error is thrown.
        blockFees: blockFees.error?.code === "PGRST202" ? [] : ((unwrap(blockFees) ?? []) as PosterBlockFeeRow[]),
      };
    },
    enabled: !!userId,
    staleTime: 60_000,
    gcTime: 5 * 60_000,
  });
}
