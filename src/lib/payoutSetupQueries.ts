/**
 * Shared fetchers + query options for the two `stripe-connect` reads that back
 * the payout section of /profile.
 *
 * Why this file exists: both reads are edge-function → Stripe round trips, the
 * slowest CLASS of request in the app. Measured against prod (2026-09-11):
 * a direct PostgREST read is 101-118ms, an RPC 103-118ms, an edge function
 * with no third-party hop 128ms — and `stripe-connect {action:"status"}` is
 * 395ms. The Deno runtime is ~20ms of that; the Stripe hop is the rest. So the
 * only two levers are (a) fire it before the user navigates and (b) let the
 * answer outlive one screen. Both need the fetchers to live outside the
 * component that renders them, so `usePrefetchUserData` can warm the exact
 * same query keys the form will read.
 */
import type { QueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { report } from "@/lib/errorLogger";
import { queryKeys } from "@/lib/queryKeys";
import { PERSIST_MAX_AGE_MS } from "@/lib/queryPersister";

export type PayoutAccountStatus = {
  connected: boolean;
  details_submitted: boolean;
  payouts_enabled: boolean;
  transfers_status: string;
  requirements: string[];
};

export type PayoutMethod = {
  id: string;
  type: string;
  last4: string;
  bank_name: string | null;
  brand: string | null;
  default_for_currency: boolean;
};

/**
 * A failed status check THROWS rather than resolving to null. Resolving null
 * made a transient stripe-connect failure indistinguishable from a brand-new
 * account, so a fully connected helper could open the form and be told
 * "Connect to start earning".
 */
export async function fetchPayoutStatus(): Promise<PayoutAccountStatus | null> {
  try {
    const res = await supabase.functions.invoke("stripe-connect", { body: { action: "status" } });
    if (res.error) throw res.error;
    return (res.data as PayoutAccountStatus | null) || null;
  } catch (err: unknown) {
    report(err, { tags: { source: "PayoutSetupForm.status" } });
    throw err;
  }
}

/** Methods are additive detail — degrade to an empty list, but never silently. */
export async function fetchPayoutMethods(): Promise<PayoutMethod[]> {
  try {
    const res = await supabase.functions.invoke("stripe-connect", { body: { action: "list_payout_methods" } });
    if (res.error) {
      report(res.error, { tags: { source: "PayoutSetupForm.methods" } });
      return [];
    }
    return (res.data?.methods as PayoutMethod[] | undefined) || [];
  } catch (err: unknown) {
    report(err, { tags: { source: "PayoutSetupForm.methods" } });
    return [];
  }
}

/**
 * PERSISTENCE POLICY — read this before copying these options.
 *
 * `methods` is the payout METHOD LIST: bank names, card brands, last4, which
 * one is default. It is a settings list. A 24h-stale copy of it shows the same
 * bank it showed yesterday and is corrected by the background revalidate a
 * beat later; nothing is gated on it. It gets `gcTime = PERSIST_MAX_AGE_MS`
 * and is written to IndexedDB.
 *
 * `status` is NOT persisted (`meta.persist === false`), deliberately. It
 * carries `payouts_enabled` and `requirements` — the answer to "will Stripe
 * actually pay this helper". A stale `payouts_enabled: true` rehydrated from
 * disk after Stripe raised a new requirement tells a helper they are set up to
 * be paid when they are not, which is a money-trust failure, not a stale
 * label. Its `gcTime` is still raised so the answer survives navigation within
 * a session (that is the /profile win the prefetch is buying); it simply dies
 * with the tab instead of living on disk for a day.
 */
export const payoutStatusQueryOptions = {
  staleTime: 60_000,
  gcTime: PERSIST_MAX_AGE_MS,
  meta: { persist: false },
} as const;

export const payoutMethodsQueryOptions = {
  staleTime: 60_000,
  gcTime: PERSIST_MAX_AGE_MS,
} as const;

/**
 * Warm both from an idle callback on a screen the user is already looking at,
 * so the 395ms Stripe hop is spent while they read the dashboard rather than
 * while they stare at /profile. `prefetchQuery` is a no-op when the key is
 * already fresh, and it never throws — a failed warm just leaves the form to
 * fetch normally.
 */
export function prefetchPayoutSetup(queryClient: QueryClient, userId: string) {
  void queryClient.prefetchQuery({
    queryKey: queryKeys.payoutSetup.status(userId),
    queryFn: fetchPayoutStatus,
    ...payoutStatusQueryOptions,
  });
  void queryClient.prefetchQuery({
    queryKey: queryKeys.payoutSetup.methods(userId),
    queryFn: fetchPayoutMethods,
    ...payoutMethodsQueryOptions,
  });
}
