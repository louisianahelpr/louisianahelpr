import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { unwrap } from "@/lib/supabaseResult";
import { useFeatureStatus } from "@/hooks/useFeature";
import { useAuthReady } from "@/hooks/useAuthReady";
import { parsePayPalPayee, type PayPalPayee } from "@/lib/paypalPayee";
import { rpcErrorMessage } from "@/lib/lifecycleErrors";

/** User-scoped; never persisted (where a member is paid must not survive a sign-out on a shared device). */
export const paypalPayeeQueryKey = (userId: string | undefined | null) => ["paypal-payee", userId] as const;

/**
 * Where the member's PayPal payout setup stands, kept apart so no screen reads
 * "not set up" for a read that failed or is still on its way (lh-silent-failure
 * review 2026-10-23):
 *   loading  the switch or the payee read has not answered yet: say nothing;
 *   error    the payee read failed: say we couldn't check (never "add your email");
 *   none     no email saved;
 *   on_hold  an email is saved but our team has payouts to it on hold;
 *   ready    a payable email (helper_accept_missing's PayPal arm on the server).
 */
export type PayPalPayeeStatus = "loading" | "error" | "none" | "on_hold" | "ready";

export interface PayPalPayeeState {
  /**
   * `paypal_payments` is on for this member. A failed re-read of the switch
   * keeps the last answer the server gave (useFeatureStatus.lastAnswer), so a
   * network blip never swaps a PayPal member's screens back to Stripe's paused
   * ones; the server decides every write on its own anyway.
   */
  on: boolean;
  /** Meaningful only while `on`. */
  status: PayPalPayeeStatus;
  /** The switch, or the payee read behind it, has not answered yet. */
  loading: boolean;
  /** status === "ready": payout setup is done. */
  ready: boolean;
  payee: PayPalPayee | null;
  error: unknown;
  /** The read's refusal in words (get_my_paypal_payee's copy), or a plain fallback; null without an error. */
  errorMessage: string | null;
  refetch: () => void;
}

/**
 * Where this member is paid through PayPal, while `paypal_payments` is on for
 * them. Reads public.get_my_paypal_payee only while the switch is on (the RPC
 * refuses otherwise).
 */
export function usePayPalPayee(): PayPalPayeeState {
  const sw = useFeatureStatus("paypal_payments");
  const { user } = useAuthReady();
  const on = sw.on || sw.lastAnswer === true;
  const q = useQuery({
    queryKey: paypalPayeeQueryKey(user?.id),
    enabled: on && !!user?.id,
    meta: { persist: false },
    staleTime: 60_000,
    queryFn: async (): Promise<PayPalPayee> => parsePayPalPayee(unwrap(await supabase.rpc("get_my_paypal_payee"))),
  });
  const payee = on ? (q.data ?? null) : null;
  const loading = !sw.settled || (on && !!user?.id && q.isPending);
  const failed = on && !q.data && !!q.error;
  const status: PayPalPayeeStatus = loading
    ? "loading"
    : failed
      ? "error"
      : !payee?.hasEmail
        ? "none"
        : payee.payable
          ? "ready"
          : "on_hold";
  return {
    on,
    status,
    loading,
    ready: on && status === "ready",
    payee,
    error: on ? q.error : null,
    errorMessage: on && q.error ? (rpcErrorMessage("get_my_paypal_payee", q.error) ?? "We couldn't load your payout details.") : null,
    refetch: () => { void q.refetch(); },
  };
}
