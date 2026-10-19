import { useRef, useState } from "react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { functionInvokeError } from "@/lib/supabaseResult";
import { requireBiometric } from "@/lib/biometricGate";
import { userFacingError } from "@/lib/userFacingError";
import { report } from "@/lib/errorLogger";
import {
  Dialog,
  DialogContent,
  DialogHero,
  DialogBody,
  DialogFooter,
  DialogSecondaryAction,
  DialogDestructiveAction,
} from "@/components/ui/dialog";
import { warnIfGiftNotReturned } from "../giftRestoreWarning";
import { HelprFaultFields } from "./HelprFaultFields";
import { helprFaultBody, toastHelprFaultOutcome, useHelprFaultCandidate, type HelprFaultKind } from "./helprFault";

interface HelprFaultDisputeJob {
  id: string;
  title?: string | null;
  helper_id?: string | null;
}

interface HelprFaultDisputeDialogProps {
  /** The disputed job, or null when closed. */
  job: HelprFaultDisputeJob | null;
  profiles: Record<string, string>;
  onClose: () => void;
  /** Called after the refund went out (reload the disputes). */
  onDone: () => void;
}

/**
 * Q2082 (b), owner 2026-10-18 ("J4"): the dispute tools' "Helpr at fault".
 * The poster reported a no-show or a backout as a dispute; the admin rules the
 * Helpr at fault and create-payment's admin_refund_dispute refunds the poster
 * in full (less a first job's $2 setup fee), bills the Helpr the card fee and
 * gives them a strike.
 */
export const HelprFaultDisputeDialog = ({ job, profiles, onClose, onDone }: HelprFaultDisputeDialogProps) => {
  const [kind, setKind] = useState<HelprFaultKind>("no_show");
  const [note, setNote] = useState("");
  const [sending, setSending] = useState(false);
  const inFlight = useRef(false);
  const candidate = useHelprFaultCandidate(job?.id, job?.helper_id, !!job);
  const body = helprFaultBody(candidate.helperId, kind, note);

  const close = () => {
    setKind("no_show");
    setNote("");
    onClose();
  };

  const send = async () => {
    if (!job || !body || inFlight.current) return;
    inFlight.current = true;
    try {
      // Face ID / Touch ID gate: this moves real escrow back out of Stripe. No-op on web.
      const ok = await requireBiometric("Confirm the Helpr-at-fault refund");
      if (!ok) return;
      setSending(true);
      const { data, error } = await supabase.functions.invoke("create-payment", {
        body: { action: "admin_refund_dispute", jobId: job.id, helprFault: body },
      });
      if (error) throw await functionInvokeError(error);
      if ((data as { error?: string } | null)?.error) throw new Error((data as { error: string }).error);
      warnIfGiftNotReturned(data);
      toastHelprFaultOutcome(data);
      close();
      onDone();
    } catch (err: unknown) {
      report(err, { tags: { source: "money.adminRefund", action: "admin_refund_dispute", screen: "/admin" }, context: { jobId: job.id, helprFault: true } });
      toast.error(userFacingError(err, "Couldn't send that refund — try again."));
    } finally {
      inFlight.current = false;
      setSending(false);
    }
  };

  return (
    <Dialog open={!!job} onOpenChange={(o) => { if (!o) close(); }}>
      <DialogContent>
        <DialogHero title="Helpr at fault?" />
        <div className="space-y-3">
          <DialogBody>
            <p>
              Rule the Helpr at fault for {job?.title ? `"${job.title}"` : "this job"} and refund the poster.
              Closes the dispute. This moves real money and can&apos;t be undone here.
            </p>
          </DialogBody>
          <HelprFaultFields
            helperId={candidate.helperId}
            helperName={candidate.helperId ? profiles[candidate.helperId] : null}
            loading={candidate.loading}
            kind={kind}
            note={note}
            onKindChange={setKind}
            onNoteChange={setNote}
          />
        </div>
        <DialogFooter>
          <DialogSecondaryAction onClick={close}>Cancel</DialogSecondaryAction>
          <DialogDestructiveAction onClick={send} disabled={sending || !body}>
            {sending ? "Refunding…" : "Refund (Helpr at fault)"}
          </DialogDestructiveAction>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
