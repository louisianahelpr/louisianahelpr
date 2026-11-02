import { useEffect } from "react";
import { toast } from "sonner";
import { report } from "@/lib/errorLogger";
import { backgroundImport } from "@/lib/chunkReload";
import { linkSetupJobOnceMore, takePendingSetupLink } from "@/lib/declutter/setupLinkPending";

/**
 * PaymentSuccess, Q1942: a Declutter "Add a Helpr" job whose order link failed at posting is linked again here, and
 * the buyer is told only if it still fails. Posting redirected to Stripe a second after its own toast; this screen
 * stays, so the words are read. A link that lands now needs no words: the order card shows the Helpr booked.
 */
export function useTellPendingSetupLink(jobId: string | null): void {
  useEffect(() => {
    const pending = takePendingSetupLink(jobId);
    if (!pending) return;
    void (async () => {
      const result = await linkSetupJobOnceMore(async () => {
        // Loaded only when a link is pending, so PaymentSuccess's chunk does not carry it.
        const { linkSetupJob } = await backgroundImport(() => import("@/lib/declutter/setupHelpr"), "declutter-setup-helpr");
        return linkSetupJob(pending.orderId, pending.jobId);
      });
      // Told even if the buyer has left this screen: the toast is app-wide, and the record was taken once.
      if (result.ok) return;
      report(result.err, { severity: "warning", tags: { source: "PaymentSuccess.linkDeclutterSetup" }, context: { job_id: pending.jobId } });
      toast.error("Your job posted, but it isn't showing on your Declutter purchase", {
        description: result.why ?? "Find it under your posted jobs.",
        duration: 15000,
      });
    })();
  }, [jobId]);
}
