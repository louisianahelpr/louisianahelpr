import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { unwrap } from "@/lib/supabaseResult";
import { useFeatureStatus } from "@/hooks/useFeature";
import { useAuthReady } from "@/hooks/useAuthReady";
import { parsePayPalPayee, type PayPalPayee } from "@/lib/paypalPayee";
import { rpcErrorMessage } from "@/lib/lifecycleErrors";

/** User-scoped; never persisted (where a member is paid must not survive a sign-out on a shared device). */
export const paypalPayeeQueryKey = (userId: string | undefined | null) => ["paypal-payee", userId] as const;

export interface PayPalPayeeState {
  /** The `paypal_payments` switch is on for this member (false while loading, on error, signed out). */
  on: boolean;
  /** The switch, or the payee read behind it, has not answered yet. */
  loading: boolean;
  /** The member has a PayPal email we will pay: payout setup is done (helper_accept_missing's PayPal arm). */
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
 * refuses otherwise). `ready` mirrors the server's paypal_payee_ready: switch
 * on AND a payable email.
 */
export function usePayPalPayee(): PayPalPayeeState {
  const { on, settled } = useFeatureStatus("paypal_payments");
  const { user } = useAuthReady();
  const q = useQuery({
    queryKey: paypalPayeeQueryKey(user?.id),
    enabled: on && !!user?.id,
    meta: { persist: false },
    staleTime: 60_000,
    queryFn: async (): Promise<PayPalPayee> => parsePayPalPayee(unwrap(await supabase.rpc("get_my_paypal_payee"))),
  });
  const payee = on ? (q.data ?? null) : null;
  return {
    on,
    loading: !settled || (on && !!user?.id && q.isPending),
    ready: on && payee?.payable === true,
    payee,
    error: on ? q.error : null,
    errorMessage: on && q.error ? (rpcErrorMessage("get_my_paypal_payee", q.error) ?? "We couldn't load your payout details.") : null,
    refetch: () => { void q.refetch(); },
  };
}
