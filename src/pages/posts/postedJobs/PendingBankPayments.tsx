import { Landmark } from "lucide-react";
import { jobAwaitsBankPayment } from "@/lib/pendingBankPayment";
import { cn } from "@/lib/utils";

type PendingJob = {
  id: string;
  title?: string | null;
  payment_status?: string | null;
  stripe_payment_intent_id?: string | null;
  status?: string | null;
};

/**
 * The poster's jobs whose bank payment is still on its way (owner,
 * 2026-10-17). They are not posts yet, so they sit in no bucket and no count;
 * without this card a poster who paid by bank saw nothing at all on My Posts
 * for up to four business days. Renders nothing when no job waits.
 */
export function PendingBankPayments({ jobs, className }: { jobs: readonly PendingJob[]; className?: string }) {
  const waiting = jobs.filter(jobAwaitsBankPayment);
  if (waiting.length === 0) return null;
  return (
    <section aria-label="Jobs waiting for your bank payment" className={cn("flex flex-col gap-2", className)}>
      {waiting.map((job) => (
        <div key={job.id} className="rounded-ds-md border border-border bg-card p-3 flex gap-3 items-start">
          <Landmark className="w-5 h-5 mt-0.5 shrink-0 text-muted-foreground" aria-hidden="true" />
          <div className="text-sm min-w-0">
            <p className="font-semibold break-words">{job.title?.trim() || "Your job"}</p>
            <p className="text-muted-foreground">
              Waiting for your bank payment. This usually takes up to 4 business days; your job posts when it arrives.
            </p>
          </div>
        </div>
      ))}
    </section>
  );
}
