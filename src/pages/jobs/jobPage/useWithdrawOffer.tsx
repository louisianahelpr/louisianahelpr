/**
 * Q2604 (Jobs audit 1102b row 18, 11-01 JA-49): the poster's "Withdraw offer" while an offer is out, so taking an
 * offer back no longer means cancelling the whole job. One confirm step, then rpc_poster_withdraw_offer
 * (20261102103429): the job reopens and the money stays with it (a held card stays held for whoever is hired next).
 *
 * Shown only while an offer is unanswered on a one-person job: a Hire's offer (accepted, a Helpr named, not
 * confirmed) or a direct offer / instant booking still pending. The server decides again under its lock and
 * refuses an Accept already capturing the card ("offer_being_accepted").
 *
 * Guard: src/test/posterWithdrawOffer.test.ts.
 */
import { useState } from "react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { BrandConfirmDialog } from "@/components/ui/BrandConfirmDialog";
import { rpcErrorMessage } from "@/lib/lifecycleErrors";
import { isMissingRpcNamed } from "@/lib/missingRpc";
import type { RowAction } from "./JobPageActionRow";

export type WithdrawableJob = {
  id: string;
  status?: string | null;
  helper_id?: string | null;
  helper_confirmed_at?: string | null;
  is_group_job?: boolean | null;
  direct_offer_status?: string | null;
};

/** Is an offer out and unanswered on this one-person job (the server's own two cases)? */
export function offerIsOut(job: WithdrawableJob | null | undefined): boolean {
  if (!job || job.is_group_job) return false;
  if (job.status === "accepted") return !!job.helper_id && !job.helper_confirmed_at;
  return job.status === "open" && job.direct_offer_status === "pending";
}

export function useWithdrawOffer(job: WithdrawableJob | null | undefined, helprFirst: string | null, onChanged: () => void): {
  action: RowAction | null;
  dialog: React.ReactNode;
} {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  if (!job || !offerIsOut(job)) return { action: null, dialog: null };
  const who = helprFirst || "your Helpr";

  const withdraw = async () => {
    setBusy(true);
    try {
      const { error } = await supabase.rpc("rpc_poster_withdraw_offer", { p_job_id: job.id });
      if (error) {
        // Before 20261102103429 reaches prod the function is missing: say so plainly (nothing changed).
        toast.error(isMissingRpcNamed(error, "rpc_poster_withdraw_offer")
          ? "Withdrawing an offer isn't ready yet. Your offer is still out; you can cancel the job instead."
          : rpcErrorMessage("rpc_poster_withdraw_offer", error) ?? "Your offer wasn't withdrawn. Try again.");
        return;
      }
      setOpen(false);
      toast("Offer withdrawn. Your job is open to other Helprs again.");
      onChanged();
    } finally {
      setBusy(false);
    }
  };

  return {
    action: { key: "withdraw", label: "Withdraw offer", go: () => setOpen(true), disabled: busy, danger: true },
    dialog: (
      <BrandConfirmDialog
        open={open}
        onOpenChange={setOpen}
        title="Withdraw your offer?"
        description={`${who} won't be able to accept it. Your job opens to other Helprs again, and your payment stays with the job.`}
        primaryLabel="Withdraw offer"
        primaryTone="sienna"
        primaryDisabled={busy}
        primaryHaptic="warning"
        onPrimary={(e) => {
          e.preventDefault();
          void withdraw();
        }}
        secondaryLabel="Cancel"
      />
    ),
  };
}
