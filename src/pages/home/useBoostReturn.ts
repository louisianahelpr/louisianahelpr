import { useEffect } from "react";
import type { NavigateFunction, SetURLSearchParams } from "react-router-dom";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { report } from "@/lib/errorLogger";
import { isJobPoster } from "@/lib/checkoutReturnOwner";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Stripe sends a paid boost back to `/home?boosted=<jobId>` (and a bailed one
 * to `?boost_cancelled=<jobId>`). Nothing consumed either param, so a poster
 * who had just paid for a boost landed on the feed with no confirmation at
 * all — the Boosted badge only appears later, on My Posts. The toast carries
 * an action so it survives the suppress-plain-success policy (see
 * lib/toastPolicy.ts): the toast IS the route to the boosted post.
 *
 * ONLY THE JOB'S POSTER IS TOLD (owner bug, 2026-10-05, the PaymentSuccess
 * class): the param is just a job id, so any signed-in account opening the
 * link was told "Your job is boosted". The job is read first and the claim
 * made only when the viewer posted it (src/lib/checkoutReturnOwner.ts).
 *
 * ONLY A BOOST THAT IS ON IS CALLED ON (Q1386 (a)): Stripe redirects before
 * its webhook lands, and the webhook (checkoutSessionCompleted) is what writes
 * boost_expires_at. The job is re-read a few times for a boost_expires_at in
 * the future; until it shows, the poster is told the payment went through and
 * the boost starts once it is confirmed, never "Your job is boosted".
 */

/** Q1386 (a): re-reads after the first, waiting for the boost webhook. */
export const BOOST_CONFIRM_DELAYS_MS = [1500, 3000, 5000];

type BoostRow = { customer_id: string | null; boost_expires_at: string | null } | null;

function boostIsOn(row: BoostRow): boolean {
  const at = row?.boost_expires_at ? Date.parse(row.boost_expires_at) : NaN;
  return Number.isFinite(at) && at > Date.now();
}
export function useBoostReturn({
  userId,
  searchParams,
  setSearchParams,
  navigate,
  confirmDelaysMs = BOOST_CONFIRM_DELAYS_MS,
}: {
  userId: string | undefined;
  searchParams: URLSearchParams;
  setSearchParams: SetURLSearchParams;
  navigate: NavigateFunction;
  /** Test seam: the waits between re-reads for the boost webhook. */
  confirmDelaysMs?: readonly number[];
}) {
  useEffect(() => {
    const boosted = searchParams.get("boosted");
    const boostCancelled = searchParams.get("boost_cancelled");
    if (!boosted && !boostCancelled) return;
    if (!userId) return; // wait for the session: the claim is per account
    const jobId = boosted ?? boostCancelled;
    let cancelled = false;
    void (async () => {
      const read = async () =>
        jobId && UUID_RE.test(jobId)
          ? await supabase.from("jobs").select("customer_id, boost_expires_at").eq("id", jobId).maybeSingle()
          : { data: null, error: null };
      // The one ownership check both branches below use (Q1385/Q1386).
      const ownsIt = (row: unknown) => isJobPoster((row as BoostRow | null)?.customer_id, userId);
      const first = await read();
      const { error } = first;
      let { data } = first;
      // A paid boost whose webhook has not landed yet: wait for it (bounded).
      if (boosted && !error && ownsIt(data)) {
        for (const ms of confirmDelaysMs) {
          if (cancelled || boostIsOn(data as BoostRow)) break;
          await new Promise((r) => setTimeout(r, ms));
          if (cancelled) return;
          const again = await read();
          if (again.error) break; // keep the last good read; the toast below stays neutral
          data = again.data;
        }
      }
      if (cancelled) return;
      if (error) {
        report(error, { tags: { source: "Dashboard.boostReturn" } });
        toast.error("We couldn't confirm this boost. Check the job in My Posts.");
      } else if (!ownsIt(data)) {
        toast.error("That boost belongs to a different account.");
      } else if (boosted && !boostIsOn(data as BoostRow)) {
        // Paid, not confirmed yet (the webhook writes boost_expires_at).
        toast.success("Payment received — your boost starts as soon as it's confirmed.", {
          action: { label: "View", onClick: () => navigate(`/posts?job=${boosted}`) },
        });
      } else if (boosted) {
        // `?boosted` IS the job id, so send the tap to that job rather than to
        // My Posts' default "Needs you" bucket — a freshly-boosted open post
        // with nobody on it yet buckets to `waiting`, so a bare /posts landed
        // on an empty list.
        toast.success("Your job is boosted — it's at the top of the feed for the next 24 hours.", {
          action: { label: "View", onClick: () => navigate(`/posts?job=${boosted}`) },
        });
      } else {
        toast.error("Boost cancelled — your job is still posted, just not boosted.");
      }
      const next = new URLSearchParams(searchParams);
      next.delete("boosted");
      next.delete("boost_cancelled");
      setSearchParams(next, { replace: true });
    })();
    return () => { cancelled = true; };
  }, [userId, searchParams, setSearchParams, navigate]);
}
