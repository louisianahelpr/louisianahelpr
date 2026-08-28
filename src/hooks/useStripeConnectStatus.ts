import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { unwrap } from "@/lib/supabaseResult";
import { report } from "@/lib/errorLogger";
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
 * - `reserve` — we don't know yet, but the last answer we got on this device
 *               said payouts were NOT enabled, so the banner is about to
 *               appear. Hold its height (aria-hidden) so nothing jumps.
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
 * One bit, not a cached status object — it is used only to decide whether to
 * reserve the banner's height on first paint, never to make a claim.
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

/** Query key — same `["profile", userId, <section>]` family as useProfileTabData. */
export const stripeConnectStatusKey = (userId: string) =>
  ["profile", userId, "stripe-connect-status"] as const;

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

  const { data, isError, refetch } = useQuery<StripeConnectStatus>({
    queryKey: stripeConnectStatusKey(userId ?? ""),
    enabled: !!userId && approved,
    // Payout status changes only when the user acts (finishing onboarding,
    // Stripe completing verification). Five minutes of staleness is invisible,
    // and the two moments it could actually change — leaving the Payment tab,
    // pull-to-refresh — invalidate this key explicitly in Profile.tsx.
    staleTime: 5 * 60_000,
    queryFn: async (): Promise<StripeConnectStatus> => {
      try {
        const raw = unwrap(
          await supabase.functions.invoke<StripeConnectStatus>("stripe-connect", {
            body: { action: "status" },
          }),
        );
        if (!raw || typeof raw.payouts_enabled !== "boolean") {
          throw new Error("stripe-connect status returned an unexpected shape");
        }
        const status: StripeConnectStatus = {
          connected: !!raw.connected,
          details_submitted: !!raw.details_submitted,
          payouts_enabled: !!raw.payouts_enabled,
        };
        if (userId) safeStorage.setItem(lastKnownKey(userId), status.payouts_enabled ? "1" : "0");
        return status;
      } catch (err) {
        report(err, {
          severity: "warning",
          tags: { area: "profile", action: "stripe-connect-status" },
        });
        throw err;
      }
    },
  });

  const payoutPrompt = useMemo<PayoutPrompt>(() => {
    if (!userId || !approved) return { kind: "none" };
    if (isError) return { kind: "error" };
    if (data) return data.payouts_enabled ? { kind: "none" } : { kind: "setup" };
    // No answer yet. Reserve the banner's height ONLY when the last answer we
    // saw said payouts were off — i.e. when the banner is genuinely likely to
    // appear. Reserving on a bare unknown would hand every already-paid user a
    // blank band that then collapses, trading one jump for another.
    return lastKnownPayoutsEnabled === false ? { kind: "reserve" } : { kind: "none" };
  }, [userId, approved, isError, data, lastKnownPayoutsEnabled]);

  return { payoutPrompt, refetchStatus: () => { void refetch(); } };
}
