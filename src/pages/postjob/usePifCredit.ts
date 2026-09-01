import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { report } from "@/lib/errorLogger";

/**
 * usePifCredit — resolve the gift card riding on `/post-job?pif_credit=<id>`
 * so CHECKOUT CAN QUOTE THE PRICE THE SERVER WILL ACTUALLY CHARGE.
 *
 * Before this hook the id was passed straight through to create-payment and
 * never read on the client, so a recipient with a $75 gift was shown a
 * full-price total ("$75 budget + $9 service fee + tax"), tapped pay, and was
 * charged $0. Being shown one number and charged another is a trust bug even
 * when the surprise is pleasant — it is exactly why the gift read as broken.
 *
 * `usable` deliberately mirrors the ownership/funding/expiry/state gate in
 * `redeem_pif_credit` (migration 20260831233515) one-for-one. If this hook
 * said "gift applied" for a credit the RPC would refuse, the screen would be
 * lying in the other direction — a $0 total against a full-price charge — so
 * every condition below exists because the server has the same one.
 */

/** The columns checkout needs. Full row shape lives in payItForward/types. */
interface PifCreditLite {
  id: string;
  amount: number;
  status: string;
  payment_status: string | null;
  expires_at: string | null;
  recipient_id: string | null;
}

/**
 * The statuses `redeem_pif_credit`'s state gate accepts:
 *   'sent'      — fresh directed gift.
 *   'available' — the legacy spelling of the same thing. The RPC accepts it
 *                 (that acceptance IS the F-GIFT-1 fix); refusing it here
 *                 would put the display back out of step with the server.
 *   'reserved'  — a partially-covered gift held against a job whose shortfall
 *                 checkout was abandoned. The RPC allows re-entry for the SAME
 *                 job, so the gift is still the poster's to spend and must
 *                 still be quoted.
 * Anything else ('redeemed', 'expired') is spent or dead.
 */
const REDEEMABLE_STATUSES = new Set(["sent", "available", "reserved"]);

export interface PifCreditState {
  /** Gift value in dollars, or 0 when there is no usable gift. */
  creditAmount: number;
  /** True only when the credit passes every check `redeem_pif_credit` makes. */
  usable: boolean;
  /** True while a credit id from the URL is still being resolved. */
  loading: boolean;
  /**
   * True when a credit id was supplied but could not be confirmed (fetch
   * failed, row missing, not this user's, unfunded, expired, already spent).
   * Checkout says so rather than silently quoting full price — a gift that
   * vanishes without a word is the original complaint.
   */
  unavailable: boolean;
}

export function usePifCredit(creditId: string | null): PifCreditState {
  const { user } = useCurrentUser();
  const enabled = !!creditId && !!user?.id;

  const { data, isLoading, isError, error } = useQuery({
    queryKey: ["pif-credit", creditId, user?.id],
    queryFn: async () => {
      const { data: row, error: qErr } = await supabase
        .from("pif_credits" as never)
        .select("id, amount, status, payment_status, expires_at, recipient_id")
        .eq("id", creditId as string)
        .maybeSingle();
      // Never drop this error. A dropped one reads as "no gift here", which
      // is the full-price quote we are trying to stop shipping.
      if (qErr) throw qErr;
      return (row ?? null) as PifCreditLite | null;
    },
    enabled,
    staleTime: 60_000,
    // A malformed id in the URL 400s on every attempt — retrying just delays
    // the honest "we couldn't confirm this gift" message.
    retry: false,
  });

  if (isError) {
    report(error, {
      severity: "warning",
      tags: { source: "usePifCredit.fetch" },
      context: { credit_id: creditId },
    });
  }

  if (!creditId) {
    return { creditAmount: 0, usable: false, loading: false, unavailable: false };
  }
  // A credit id is present but the session hasn't resolved yet, so the query
  // hasn't been allowed to run. That is "still checking", NOT "no gift" —
  // reporting it as the latter would print a full-price total for a post the
  // server is about to settle for free.
  if (!enabled || isLoading) {
    return { creditAmount: 0, usable: false, loading: true, unavailable: false };
  }

  // Same gate as redeem_pif_credit, in the same order.
  const amount = Number(data?.amount ?? 0);
  const notExpired =
    !data?.expires_at || new Date(data.expires_at).getTime() > Date.now();
  const usable =
    !!data &&
    data.recipient_id === user?.id &&
    data.payment_status === "paid" &&
    notExpired &&
    REDEEMABLE_STATUSES.has(data.status) &&
    Number.isFinite(amount) &&
    amount > 0;

  return {
    creditAmount: usable ? amount : 0,
    usable,
    loading: false,
    unavailable: !usable,
  };
}
