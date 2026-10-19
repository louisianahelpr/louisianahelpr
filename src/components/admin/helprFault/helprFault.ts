// Q2082 (b), owner 2026-10-18 ("J4"): an admin rules the Helpr at fault (a
// no-show or a backout) after the poster reports it. create-payment's
// admin_refund_general and admin_refund_dispute take `helprFault`: the poster
// gets everything back except a first job's $2 setup fee, the Helpr is charged
// the card fee (out of their next payout) and gets a strike. If the Helpr's
// account is gone at refund time, the refund keeps the card fee instead.
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { report } from "@/lib/errorLogger";

export type HelprFaultKind = "no_show" | "backout";

export interface HelprFaultBody {
  helperId: string;
  kind: HelprFaultKind;
  note: string;
}

/** What create-payment answers about the Helpr-fault part of a refund. */
export interface HelprFaultOutcome {
  cardFeeBilledCents: number | null;
  billFailed: boolean;
  helprGone: boolean;
}

export const NO_HELPR_COPY = "No Helpr on this job any more (account gone?). Use a normal refund: it keeps the card fee.";

export const HELPR_FAULT_CONFIRM_COPY =
  "The poster gets everything back except a first job's $2 setup fee. The Helpr is charged the card fee (it comes out of their next payout) and gets a strike. If the Helpr's account is gone at refund time, the refund keeps the card fee instead.";

/** The body field, or null when the form is not complete (no Helpr or no note). */
export function helprFaultBody(helperId: string | null, kind: HelprFaultKind, note: string): HelprFaultBody | null {
  const trimmed = note.trim();
  if (!helperId || !trimmed) return null;
  return { helperId, kind, note: trimmed };
}

/** Says what happened to the Helpr's part. Every outcome is said out loud. */
export function toastHelprFaultOutcome(data: unknown): void {
  const outcome = (data as { helprFault?: Partial<HelprFaultOutcome> } | null)?.helprFault;
  if (!outcome) {
    toast.warning("Refund sent, but the server did not confirm the Helpr-at-fault part. Check the job's audit log.");
    return;
  }
  if (outcome.helprGone) {
    toast.warning("Helpr's account is gone: the card fee was kept from the refund.");
  } else if (outcome.billFailed) {
    toast.error("Refund sent; billing the Helpr failed. Open the job in Admin > Jobs and press Bill the Helpr.");
  } else {
    const fee = typeof outcome.cardFeeBilledCents === "number" ? ` $${(outcome.cardFeeBilledCents / 100).toFixed(2)}` : "";
    toast.success(`Refund sent. The Helpr was charged the${fee} card fee and given a strike.`);
  }
}

/**
 * The Helpr to rule against: the job's Helpr, or (the no-show report unassigns
 * them) the Helpr on the job's no_show / job_denial strike. null when neither
 * exists (the account is gone, or nobody was booked).
 */
export function useHelprFaultCandidate(
  jobId: string | null | undefined,
  jobHelperId: string | null | undefined,
  enabled: boolean,
): { helperId: string | null; loading: boolean } {
  const [found, setFound] = useState<{ jobId: string; helperId: string | null } | null>(null);
  useEffect(() => {
    if (!enabled || !jobId || jobHelperId) return;
    let live = true;
    void (async () => {
      const { data, error } = await supabase
        .from("user_violations")
        .select("user_id")
        .eq("job_id", jobId)
        .in("violation_type", ["no_show", "job_denial"])
        .order("created_at", { ascending: false })
        .limit(1);
      if (error) report(error, { severity: "warning", tags: { source: "helprFault.candidate" }, context: { jobId } });
      if (live) setFound({ jobId, helperId: data?.[0]?.user_id ?? null });
    })();
    return () => { live = false; };
  }, [jobId, jobHelperId, enabled]);
  if (jobHelperId) return { helperId: jobHelperId, loading: false };
  if (!enabled || !jobId) return { helperId: null, loading: false };
  if (found?.jobId !== jobId) return { helperId: null, loading: true };
  return { helperId: found.helperId, loading: false };
}
