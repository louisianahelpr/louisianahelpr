import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { unwrap } from "@/lib/supabaseResult";
import { useCurrentUser } from "@/hooks/useCurrentUser";

/**
 * Board 143: the member's own money problems, read from server records only.
 *  - open payout failures (payout_failures, written by stripe-webhook on
 *    payout.failed, closed on a later payout.paid; RLS: own rows);
 *  - what is owed from the next payout: Helpr-at-fault card fees
 *    (job_helpr_fault_rulings.card_fee_remaining_cents) and Declutter/Shops
 *    seller card-fee debts (declutter_seller_fee_debts.remaining_cents). Both
 *    are taken by the payout runs themselves; nothing here computes a payout.
 */
type PayoutFailure = { id: string; amount_cents: number; failure_code: string | null; failed_at: string };
export type FeeOwed = { id: string; kind: "fault" | "seller"; cents: number };

const payoutProblemKeys = {
  failures: (uid: string | null | undefined) => ["money", "payout-failures", uid] as const,
  owed: (uid: string | null | undefined) => ["money", "fees-owed", uid] as const,
};

export function useOpenPayoutFailures() {
  const { user } = useCurrentUser();
  const uid = user?.id;
  return useQuery({
    queryKey: payoutProblemKeys.failures(uid),
    enabled: !!uid,
    staleTime: 60_000,
    queryFn: async () =>
      unwrap(
        await supabase
          .from("payout_failures")
          .select("id, amount_cents, failure_code, failed_at")
          .is("resolved_at", null)
          .order("failed_at", { ascending: false }),
      ) as PayoutFailure[],
  });
}

export function useFeesOwed() {
  const { user } = useCurrentUser();
  const uid = user?.id;
  return useQuery({
    queryKey: payoutProblemKeys.owed(uid),
    enabled: !!uid,
    staleTime: 60_000,
    queryFn: async (): Promise<FeeOwed[]> => {
      const fault = unwrap(
        await supabase
          .from("job_helpr_fault_rulings")
          .select("id, card_fee_remaining_cents")
          .eq("helper_id", uid!)
          .gt("card_fee_remaining_cents", 0),
      ) as { id: string; card_fee_remaining_cents: number }[];
      const seller = unwrap(
        await supabase
          .from("declutter_seller_fee_debts")
          .select("id, remaining_cents")
          .eq("seller_id", uid!)
          .gt("remaining_cents", 0),
      ) as { id: string; remaining_cents: number }[];
      return [
        ...fault.map((r) => ({ id: r.id, kind: "fault" as const, cents: r.card_fee_remaining_cents })),
        ...seller.map((r) => ({ id: r.id, kind: "seller" as const, cents: r.remaining_cents })),
      ];
    },
  });
}

/** Stripe's payout failure codes in plain words; unknown codes say nothing. */
const FAILURE_WORDS: Record<string, string> = {
  account_closed: "The bank account is closed.",
  account_frozen: "The bank account is frozen.",
  bank_account_restricted: "The bank account can't take this payout.",
  bank_ownership_changed: "The bank account changed owners.",
  could_not_process: "The bank couldn't process it.",
  debit_not_authorized: "The bank didn't allow it.",
  incorrect_account_holder_name: "The name on the bank account doesn't match.",
  invalid_account_number: "The account number isn't right.",
  invalid_currency: "The bank account can't take US dollars.",
  no_account: "The bank couldn't find that account.",
};

export function payoutFailureWords(code: string | null): string | null {
  return code ? FAILURE_WORDS[code] ?? null : null;
}
