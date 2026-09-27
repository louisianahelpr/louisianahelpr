import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { safeStorage } from "@/lib/safeStorage";
import { report } from "@/lib/errorLogger";
import { DRAFT_CHECKOUT_JOB_KEY, dropSpentDraft } from "@/hooks/useDraftJob";
import { NEVER_PAID_STATUSES } from "@/lib/neverPaidStatuses";

/**
 * What "Load Draft" may say about the job the kept draft was last sent to
 * Checkout for (Q769):
 *   none  — no checkout on record, or it ended unpaid (cancelled, expired):
 *           the draft is the poster's to reuse.
 *   open  — the job is not paid yet but its Checkout Session is still live
 *           (a delayed webhook, a decline being retried, a tab left open):
 *           the poster may already have paid, so warn before a second pay.
 *   paid  — the job is funded: the draft is spent and is dropped.
 */
export type DraftCheckoutState = "none" | "open" | "paid";

export function classifyDraftCheckout(
  row: { payment_status: string | null; stripe_session_id: string | null } | null,
): DraftCheckoutState {
  if (!row) return "none"; // job deleted: nothing was paid
  const status = row.payment_status;
  if (status === null || (NEVER_PAID_STATUSES as readonly string[]).includes(status)) {
    return row.stripe_session_id ? "open" : "none";
  }
  // escrow, payout_pending, released, refunded, disputed…: money moved.
  return "paid";
}

export function useDraftCheckoutState(hasDraft: boolean): DraftCheckoutState {
  // Start on the warning, not the plain card, while a checkout job is on
  // record: until the query answers, a paid draft must not look loadable.
  const [state, setState] = useState<DraftCheckoutState>(() =>
    safeStorage.getItem(DRAFT_CHECKOUT_JOB_KEY) ? "open" : "none",
  );
  useEffect(() => {
    if (!hasDraft) return;
    const jobId = safeStorage.getItem(DRAFT_CHECKOUT_JOB_KEY);
    if (!jobId) return;
    let cancelled = false;
    void (async () => {
      const { data, error } = await supabase
        .from("jobs")
        .select("payment_status, stripe_session_id")
        .eq("id", jobId)
        .maybeSingle();
      if (cancelled) return;
      if (error) {
        // Unknown is not "safe to pay again": warn.
        report(error, { tags: { source: "PostJob.draftCheckoutState" }, context: { job_id: jobId } });
        setState("open");
        return;
      }
      const next = classifyDraftCheckout(data);
      if (next === "paid") {
        dropSpentDraft();
      } else if (next === "none") {
        safeStorage.removeItem(DRAFT_CHECKOUT_JOB_KEY);
      }
      setState(next);
    })();
    return () => { cancelled = true; };
  }, [hasDraft]);
  return state;
}
