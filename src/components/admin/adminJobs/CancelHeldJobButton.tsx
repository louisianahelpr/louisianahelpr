import { useRef, useState } from "react";
import { toast } from "sonner";
import { XCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { functionInvokeError } from "@/lib/supabaseResult";
import { userFacingError } from "@/lib/userFacingError";
import { report } from "@/lib/errorLogger";

/**
 * Q2449: an admin cancels a job whose poster's card is only HELD (nothing was charged). It runs the poster's own
 * cancel (create-payment cancel_escrow, its held branch): the job closes, the hold is released with no refund and
 * no fee, and the poster is told their card was not charged. The server checks the admin role and refuses any
 * charged job (that is Refund Poster). Two taps: the first asks, the second cancels.
 */
export const CancelHeldJobButton = ({ jobId, onCancelled }: { jobId: string; onCancelled: () => void }) => {
  const [confirming, setConfirming] = useState(false);
  const [sending, setSending] = useState(false);
  const inFlight = useRef(false);

  const cancel = async () => {
    if (!confirming) { setConfirming(true); return; }
    if (inFlight.current) return;
    inFlight.current = true;
    setSending(true);
    try {
      const { data, error } = await supabase.functions.invoke("create-payment", {
        body: { action: "cancel_escrow", jobId, reason: "Cancelled by an admin from Admin > Jobs" },
      });
      if (error) throw await functionInvokeError(error);
      if ((data as { error?: string } | null)?.error) throw new Error((data as { error: string }).error);
      toast("Job cancelled. The card hold is released and the poster was told they weren't charged.");
      onCancelled();
    } catch (err: unknown) {
      report(err, { tags: { source: "money.adminCancelHeld", action: "cancel_escrow", screen: "/admin" }, context: { jobId } });
      toast.error(userFacingError(err, "Couldn't cancel this job. Try again."));
    } finally {
      inFlight.current = false;
      setSending(false);
      setConfirming(false);
    }
  };

  return (
    <Button
      variant="outline"
      size="sm"
      onClick={cancel}
      disabled={sending}
      className="ctl-tint-danger gap-1.5 text-destructive-ink border-destructive/40"
    >
      <XCircle className="w-3.5 h-3.5" /> {sending ? "Cancelling..." : confirming ? "Tap again to cancel and release the hold" : "Cancel job (card on hold)"}
    </Button>
  );
};
