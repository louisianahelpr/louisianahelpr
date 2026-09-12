import { useEffect, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { report } from "@/lib/errorLogger";
import { queryKeys } from "@/lib/queryKeys";
import {
  fetchPayoutStatus,
  payoutStatusQueryOptions,
  type PayoutAccountStatus,
} from "@/lib/payoutSetupQueries";
import { safeStorage } from "@/lib/safeStorage";
import { useCurrentUser } from "@/hooks/useCurrentUser";

/** Shape returned by the `stripe-connect` edge function's `status` action. */
interface StripeConnectStatus {
  connected: boolean;
  details_submitted: boolean;
  payouts_enabled: boolean;
}

/**
 * What the Profile landing should render in the payout slot, decided ONCE
 * here so the banner and the "Payout & Payments" row badge can never
 * disagree about the same fact.
 *
 * - `none`    — payouts work, or the question doesn't apply. Render nothing.
 * - `reserve` — we don't know yet. Hold the banner's height (aria-hidden) so
 *               that whatever the answer turns out to be, nothing below this
 *               slot moves when it arrives.
 * - `setup`   — confirmed: this account cannot receive money yet.
 * - `error`   — the status call FAILED. Deliberately its own state: it must
 *               never be collapsed into `none`, which looks identical to
 *               "everything is fine" to a user who is in fact unpaid.
 */
export type PayoutPrompt =
  | { kind: "none" }
  | { kind: "reserve" }
  | { kind: "setup" }
  | { kind: "error" };

export interface StripeConnectStatusResult {
  payoutPrompt: PayoutPrompt;
  /** Re-ask Stripe after a failed check (drives the error row's Retry). */
  refetchStatus: () => void;
}

/**
 * Per-account memo of the LAST successful answer to "are payouts enabled?".
 * One bit, not a cached status object — it must never be rendered as a claim.
 * It decides ONE thing: whether to skip reserving the banner's height, which
 * is safe only for a device that has already been told payouts are enabled.
 *
 * `helpr_` prefix so `safeStorage` mirrors it into Capacitor Preferences —
 * plain localStorage is evicted by WebKit on the exact cold launch this is
 * meant to survive.
 */
const LAST_KNOWN_PREFIX = "helpr_payouts_enabled";

const lastKnownKey = (userId: string) => `${LAST_KNOWN_PREFIX}_${userId}`;

function readLastKnown(userId: string | undefined): boolean | null {
  if (!userId) return null;
  const raw = safeStorage.getItem(lastKnownKey(userId));
  return raw === "1" ? true : raw === "0" ? false : null;
}

/**
 * Query key — deliberately THE SAME KEY `PayoutSetupForm` reads.
 *
 * It used to be `["profile", userId, "stripe-connect-status"]`, a second,
 * private key over the identical request: `stripe-connect { action: "status" }`,
 * measured at 444ms median against prod because it is an edge function making a
 * live Stripe call. Two keys meant /profile asked Stripe the same question
 * twice — once for the landing's payout banner, once for the payout form — and
 * React Query cannot dedupe what it cannot see is the same query. One key, one
 * round trip, and the Dashboard's idle prefetch now warms BOTH consumers.
 *
 * The cached VALUE is the full `PayoutAccountStatus` (the form needs
 * `requirements` / `transfers_status`); this hook narrows it per-observer via
 * `select`, which never writes back to the cache.
 */
export const stripeConnectStatusKey = (userId: string) =>
  queryKeys.payoutSetup.status(userId);

/**
 * The signed-in user's Stripe Connect payout status, for the Profile landing.
 *
 * WHY THIS IS A QUERY AND NOT A useEffect
 *
 * It was `useState(null)` + `useEffect(…, [profile])` in `Profile.tsx`, and
 * the owner saw the result on device: "everything loads then once everything
 * is there then enter payout info loads after". Three compounding reasons,
 * none of them a slow database:
 *
 *   1. The effect could not even START until `profile` had been set, so the
 *      round-trip began after the page had already painted.
 *   2. That round-trip is an edge function that calls the STRIPE API, so it
 *      is far slower than the Postgres queries feeding the rest of the page.
 *   3. Nothing was cached. Profile is a tab people open constantly, and every
 *      single mount re-asked Stripe — so the late banner was not a cold-start
 *      cost, it was every time.
 *
 * Reading the user from the `useCurrentUser` cache (rather than awaiting
 * another auth round-trip) means the request goes out as early as it can, and
 * `staleTime` means re-entering Profile in the same session is instant.
 *
 * FAILURES ARE NOT SUCCESS. The old catch swallowed the error into a
 * fabricated `{ connected: false, … }`, which told a user with a perfectly
 * good payout account to go set one up. `unwrap()` throws instead, the query
 * enters `isError`, and that surfaces as its own honest `error` prompt with a
 * retry — plus a `report()` so a broken edge function is visible to us rather
 * than only to the user. CLAUDE.md: never drop the Supabase `error`.
 */
export function useStripeConnectStatus(): StripeConnectStatusResult {
  const { user, profile } = useCurrentUser();
  const userId = user?.id;
  // Same gate the old effect used: only an approved account is expected to
  // have a payout account, so nobody else pays for this round-trip.
  const approved = profile?.approval_status === "approved";

  // Read the seed when the id resolves and then leave it alone. It must NOT
  // track the query result: flipping it mid-session would re-open a reserved
  // slot after the real answer had already settled the layout.
  const lastKnownPayoutsEnabled = useMemo(() => readLastKnown(userId), [userId]);

  const { data, isError, refetch } = useQuery<PayoutAccountStatus | null, Error, StripeConnectStatus>({
    queryKey: stripeConnectStatusKey(userId ?? ""),
    enabled: !!userId && approved,
    queryFn: fetchPayoutStatus,
    // staleTime / gcTime / the never-persist policy all live with the fetcher
    // in payoutSetupQueries.ts — one place, so the two consumers of this key
    // cannot drift into disagreeing about how long a payout answer is good for.
    ...payoutStatusQueryOptions,
    // Narrow to the three booleans this screen renders. `select` runs per
    // observer and does NOT write to the cache, so PayoutSetupForm still reads
    // the full object off the same key.
    select: (raw): StripeConnectStatus => {
      if (!raw || typeof raw.payouts_enabled !== "boolean") {
        // Reported here, not swallowed: a malformed answer renders the same
        // `error` prompt as a failed call, and if it were silent a broken
        // edge-function deploy would look to us exactly like a healthy one.
        // (The transport-level failure is reported by `fetchPayoutStatus`.)
        const err = new Error("stripe-connect status returned an unexpected shape");
        report(err, { severity: "warning", tags: { area: "profile", action: "stripe-connect-status" } });
        throw err;
      }
      return {
        connected: !!raw.connected,
        details_submitted: !!raw.details_submitted,
        payouts_enabled: !!raw.payouts_enabled,
      };
    },
  });

  // The last-known bit is written from the RESULT rather than from inside the
  // queryFn: the fetch is now shared with PayoutSetupForm (and warmed by the
  // Dashboard prefetch), so a queryFn side effect would fire for callers that
  // have nothing to do with this banner — or not at all, when the answer comes
  // from the cache. An effect fires exactly when this hook has an answer.
  useEffect(() => {
    if (!userId || !data) return;
    safeStorage.setItem(lastKnownKey(userId), data.payouts_enabled ? "1" : "0");
  }, [userId, data]);

  const payoutPrompt = useMemo<PayoutPrompt>(() => {
    if (!userId || !approved) return { kind: "none" };
    if (isError) return { kind: "error" };
    if (data) return data.payouts_enabled ? { kind: "none" } : { kind: "setup" };
    // No answer yet. Reserve the banner's height on the bare UNKNOWN — a
    // fresh install has no last-known bit, and that is exactly the cold launch
    // that measured 0.0514 route CLS as the banner popped in and shoved the
    // page 67px. The ONE case we skip is a device that has already been told
    // payouts are enabled: that user's banner is not coming, so reserving for
    // them would only trade their jump for a collapsing blank band (measured
    // 0.0538 when the reserve fired unconditionally). Fresh install with
    // payouts enabled still sees the placeholder once; nothing on the device
    // can distinguish it from the unpaid case until the RPC answers.
    return lastKnownPayoutsEnabled === true ? { kind: "none" } : { kind: "reserve" };
  }, [userId, approved, isError, data, lastKnownPayoutsEnabled]);

  return { payoutPrompt, refetchStatus: () => { void refetch(); } };
}
