/**
 * The gift card tab's URL handling (moved out of GiftCard.tsx, Q806; code unchanged): the Stripe return
 * (?gift=success | ?gift=cancelled) and claiming a directed gift, from the emailed ?claim=<token> link or the
 * card's own Claim This Gift button. The claim-gift-card edge function is the authority.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { functionErrorMessage } from "@/lib/supabaseResult";
import { hapticSuccess } from "@/lib/haptics";
import { errorToast } from "@/lib/toast";
import { report } from "@/lib/errorLogger";
import { userFacingError } from "@/lib/userFacingError";

export function useGiftClaimAndReturn({ authLoading, userId }: { authLoading: boolean; userId: string | undefined }) {
  const [searchParams, setSearchParams] = useSearchParams();
  const queryClient = useQueryClient();
  const user = userId ? { id: userId } : null;

  // ── Claim state (?claim=<token> cold-start from the emailed gift link) ─────
  const [claiming, setClaiming] = useState(false);
  // Fire the claim exactly once per token — the effect re-runs as auth settles
  // and as we strip the param, so a ref (not just the param) gates it.
  const claimedTokenRef = useRef<string | null>(null);


  // ── Stripe return handling (?gift=success | ?gift=cancelled) ───────────────
  useEffect(() => {
    const gift = searchParams.get("gift");
    if (gift === "cancelled") {
      toast("Gift cancelled", { description: "No charge was made." });
    }
    // `success` had no branch at all: the donor came back from Stripe having
    // been charged, the param was silently stripped, and nothing on the page
    // acknowledged it. Nothing invalidated the sent list either, so the gift
    // they had just bought was usually still missing from "Gift cards you've
    // sent" — the row is minted asynchronously by the webhook.
    if (gift === "success") {
      toast("Gift sent", {
        description: "We've emailed your recipient a link to claim it. It'll appear below in a moment.",
      });
      void queryClient.invalidateQueries({ queryKey: ["gift-cards-sent"] });
    }
    if (gift) {
      searchParams.delete("gift");
      setSearchParams(searchParams, { replace: true });
    }
    // Only react to the param on mount / when it changes.
  }, [searchParams, setSearchParams, queryClient]);

  // ── Claim a directed gift (?claim=<token>) ────────────────────────────────
  // The donor's email carried a claim link. This route is ProtectedRoute-
  // wrapped, so an unauthenticated visitor is bounced to /login?redirect=…
  // and returns here signed in — by the time this fires, `user` is the caller
  // who should own the gift. The edge function is the authority: it enforces
  // the email-match guard, idempotency, and the race-safe atomic bind; we just
  // surface its verdict.
  // Extracted from the ?claim= effect so the SAME path serves the emailed link
  // and the in-app "Claim This Gift" button on an unclaimed card. Before this
  // there was no claim affordance anywhere in the UI: claiming fired only from
  // the URL, so a recipient who arrived via the dashboard teaser instead of the
  // email had no way to bind their gift, and a transient 500 on the link burned
  // the token for the session with no retry.
  const claimGift = useCallback(
    async (claimToken: string) => {
      setClaiming(true);
      try {
        const { data, error } = await supabase.functions.invoke("claim-gift-card", {
          body: { claim_token: claimToken },
        });
        if (error) {
          throw new Error(await functionErrorMessage(error, "Couldn't claim this gift. Please try again."));
        }
        if (data?.error) throw new Error(data.error);
        if (!data?.ok) throw new Error("Couldn't claim this gift. Please try again.");

        hapticSuccess();
        // Claiming used to be entirely silent — same haptic, no words. The
        // server already tells us whether this was the real bind or a repeat
        // click, and `already_claimed` was read and thrown away.
        toast(
          data.already_claimed ? "Already yours" : "Gift claimed",
          {
            description: data.already_claimed
              ? "This gift is already attached to your account."
              : "It's attached to your account and ready to use.",
          },
        );
        // Surface the freshly-attached credit in the received list, and clear
        // the gift card banner's 5-minute cache (useSpendableGiftCards, top of
        // Post a Job) so its count and dismissal key follow the claim.
        await Promise.all([
          queryClient.invalidateQueries({ queryKey: ["gift-cards-received"] }),
          queryClient.invalidateQueries({ queryKey: ["gift-card-count"] }),
        ]);
        return true;
      } catch (e) {
        report(e, { tags: { source: "GiftCard.claim" } });
        errorToast("Couldn't claim gift card", {
          description: userFacingError(e, "Try again?"),
        });
        return false;
      } finally {
        setClaiming(false);
      }
    },
    [queryClient],
  );

  useEffect(() => {
    const claimToken = searchParams.get("claim");
    if (!claimToken) return;
    // Wait for the session to resolve — on a cold start `user` is briefly null
    // while ProtectedRoute settles; acting now would misread "not signed in".
    if (authLoading || !user?.id) return;
    // Exactly-once per token.
    if (claimedTokenRef.current === claimToken) return;
    claimedTokenRef.current = claimToken;

    void (async () => {
      const ok = await claimGift(claimToken);
      // A FAILED claim must not burn the token. The ref exists to stop the
      // effect double-firing, not to make one transient 500 permanent — and
      // because the URL is stripped below, clearing it cannot re-trigger the
      // effect. The card's own "Claim This Gift" button is the real retry.
      if (!ok) claimedTokenRef.current = null;
      // Strip ?claim so a refresh / back-nav doesn't replay it — and so the
      // bearer token stops riding in the URL (and in analytics pageviews).
      searchParams.delete("claim");
      setSearchParams(searchParams, { replace: true });
    })();
  }, [searchParams, setSearchParams, authLoading, user?.id, claimGift]);

  return { claiming, claimGift };
}
