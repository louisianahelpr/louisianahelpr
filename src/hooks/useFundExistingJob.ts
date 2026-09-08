import { useState, useRef } from "react";
import { Capacitor } from "@capacitor/core";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { openExternalUrl } from "@/lib/openExternalUrl";
import { hapticError } from "@/lib/haptics";
import { report } from "@/lib/errorLogger";

/**
 * Fund a job that ALREADY EXISTS, by sending its poster to Stripe Checkout.
 *
 * Why this exists at all: `str-ical-sync` inserts a cleaning job from the
 * host's Airbnb/VRBO calendar with `payment_status` left at its default
 * `'unpaid'`, and since migration 20260831010000 all three browse surfaces
 * (`get_ranked_open_jobs`, `open_jobs_browse`, `get_open_jobs_for_map`)
 * require `payment_status IN ('escrow','payout_pending','released')`.
 *
 * So the row was structurally invisible to every helper on the platform while
 * the HOST could still see it — their own screens read `public.jobs` directly.
 * The sync looked like it worked. That is the trap: not "no applicants yet"
 * but a job nobody could ever open, with nothing anywhere saying so.
 *
 * The backend for this was never missing. `create-payment` takes a `jobId`,
 * reads the existing row and mints a Checkout Session; it does not create the
 * job, and its guard only refuses when `payment_status` is already something
 * other than `'unpaid'`. An unfunded job passes it. What did not exist was any
 * caller — every other client action is `release`/`tip`/`resolve_revision`/
 * `admin_*`, and only the post-a-job flow funds, only for a job it just made.
 *
 * ── The one deliberate difference from `useJobSubmit` ─────────────────────
 * That flow deletes the job when payment setup fails (`cleanupOrphanJob`),
 * which is right THERE: it created the row seconds earlier and an unfunded
 * leftover would be litter. It would be badly wrong here. This job came from
 * the host's real calendar and represents a real guest checkout on a real
 * date; a transient Stripe error must never destroy it. So failure leaves the
 * row exactly as it was and says so — the host can retry.
 */
export interface FundJobResult {
  fundJob: (jobId: string) => Promise<void>;
  fundingJobId: string | null;
  isFunding: boolean;
}

export function useFundExistingJob(): FundJobResult {
  const [fundingJobId, setFundingJobId] = useState<string | null>(null);
  // Guards the double-tap: the redirect is async and the button stays mounted
  // until the page unloads, so state alone can be raced on a slow network.
  const inFlight = useRef(false);

  const fundJob = async (jobId: string) => {
    if (inFlight.current) return;
    inFlight.current = true;
    setFundingJobId(jobId);

    try {
      const { data, error } = await supabase.functions.invoke("create-payment", {
        body: {
          action: "escrow",
          jobId,
          native: Capacitor.isNativePlatform(),
          // Not passed: `saveCardForFuture` (this is a one-off turnover, not a
          // series) and `pifCreditId` (a gift is redeemed at post time, and
          // this job was never posted by hand).
        },
      });

      // `functions.invoke` reports a handled edge error in `data.error` rather
      // than `error`, so checking only `error` would treat a refusal as a
      // success and send the host to `undefined`.
      const url = data?.url;
      if (error || data?.error || !url) {
        const message = data?.error || error?.message || "Payment setup failed";
        report(new Error(`fund existing job failed: ${message}`), {
          tags: { source: "useFundExistingJob" },
          context: { job_id: jobId },
        });
        hapticError();
        // Deliberately says the job is untouched. The host is looking at a real
        // turnover for a real guest, and "couldn't start payment" alone reads
        // like it might have been cancelled.
        toast.error(`Couldn't start payment: ${message}. The job is still here — try again.`);
        return;
      }

      await openExternalUrl(url);
    } catch (err) {
      report(err, { tags: { source: "useFundExistingJob" }, context: { job_id: jobId } });
      hapticError();
      toast.error("We couldn't set up payment just yet — the job is still here, please try again.");
    } finally {
      inFlight.current = false;
      setFundingJobId(null);
    }
  };

  return { fundJob, fundingJobId, isFunding: fundingJobId !== null };
}
