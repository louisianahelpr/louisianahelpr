import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { DollarSign } from "lucide-react";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { functionInvokeError } from "@/lib/supabaseResult";
import { userFacingError } from "@/lib/userFacingError";
import { report } from "@/lib/errorLogger";

/**
 * Q2158 (lh-money-escrow review of c4ec33afb #2): a Helpr-at-fault refund
 * closes the job, so its refund buttons are gone; when billing the Helpr the
 * card fee failed after the refund went out (money_at_risk paged), this is the
 * retry. Shown only while the job has a ruling whose card fee is not billed
 * yet. create-payment's admin_bill_helpr_fault moves no money and bills once.
 */
export const BillHelprFaultButton = ({ jobId }: { jobId: string }) => {
  const [unbilled, setUnbilled] = useState<{ jobId: string; value: boolean } | null>(null);
  const [sending, setSending] = useState(false);
  const inFlight = useRef(false);

  useEffect(() => {
    let live = true;
    void (async () => {
      const { data, error } = await supabase
        .from("job_helpr_fault_rulings")
        .select("card_fee_cents")
        .eq("job_id", jobId)
        .maybeSingle();
      if (error) report(error, { severity: "warning", tags: { source: "helprFault.unbilled" }, context: { jobId } });
      if (live) setUnbilled({ jobId, value: !error && !!data && data.card_fee_cents == null });
    })();
    return () => { live = false; };
  }, [jobId]);

  if (unbilled?.jobId !== jobId || !unbilled.value) return null;

  const bill = async () => {
    if (inFlight.current) return;
    inFlight.current = true;
    setSending(true);
    try {
      const { data, error } = await supabase.functions.invoke("create-payment", {
        body: { action: "admin_bill_helpr_fault", jobId },
      });
      if (error) throw await functionInvokeError(error);
      if ((data as { error?: string } | null)?.error) throw new Error((data as { error: string }).error);
      const billed = (data as { helprFault?: { cardFeeBilledCents?: number | null } } | null)?.helprFault?.cardFeeBilledCents;
      toast.success(typeof billed === "number" ? `The Helpr was billed the $${(billed / 100).toFixed(2)} card fee.` : "The Helpr was billed the card fee.");
      setUnbilled({ jobId, value: false });
    } catch (err: unknown) {
      report(err, { tags: { source: "money.adminRefund", action: "admin_bill_helpr_fault", screen: "/admin" }, context: { jobId } });
      toast.error(userFacingError(err, "Couldn't bill the Helpr. Try again."));
    } finally {
      inFlight.current = false;
      setSending(false);
    }
  };

  return (
    <Button variant="outline" size="sm" onClick={bill} disabled={sending} className="gap-1.5">
      <DollarSign className="w-3.5 h-3.5" /> {sending ? "Billing..." : "Bill the Helpr"}
    </Button>
  );
};
