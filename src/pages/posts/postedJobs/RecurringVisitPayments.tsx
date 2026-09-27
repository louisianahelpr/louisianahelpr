import { useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { CreditCard, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { unwrap, functionErrorMessage } from "@/lib/supabaseResult";
import { report } from "@/lib/errorLogger";
import { hapticError } from "@/lib/haptics";
import { isNativePlatform } from "@/lib/nativeInit";
import { openExternalUrl } from "@/lib/openExternalUrl";

/**
 * Q210(b): recurring visits of $300 or more are never charged off-session
 * (owner, 2026-09-27) — 3D Secure needs the payer there. charge-recurring-visits
 * parks each one in recurring_visit_payments as 'pending' and notifies the
 * payer; this is where they tap to pay it. create-payment (action
 * "recurring_visit") opens a Stripe Checkout for exactly the parked amount, and
 * the webhook marks it paid. Nothing renders when nothing is waiting.
 */
type PendingVisitPayment = {
  id: string;
  visit_date: string;
  amount_cents: number;
  parent_job_id: string;
  jobs: { title: string | null } | null;
};

export function RecurringVisitPayments({ userId }: { userId: string }) {
  const [payingId, setPayingId] = useState<string | null>(null);
  const inFlight = useRef(false);

  const { data, error, refetch } = useQuery({
    queryKey: ["recurring-visit-payments", userId],
    enabled: !!userId,
    staleTime: 30_000,
    queryFn: async () => {
      // The server refuses a visit whose date has arrived (UTC), so match it.
      const todayUtc = new Date().toISOString().slice(0, 10);
      return unwrap(
        await supabase
          .from("recurring_visit_payments")
          .select("id, visit_date, amount_cents, parent_job_id, jobs!recurring_visit_payments_parent_job_id_fkey(title)")
          .eq("payer_id", userId)
          .eq("status", "pending")
          .gt("visit_date", todayUtc)
          .order("visit_date", { ascending: true }),
      ) as unknown as PendingVisitPayment[];
    },
  });

  if (error) {
    return (
      <div role="alert" className="rounded-ds-md border border-destructive/40 p-3 text-sm">
        We couldn't check for visits waiting on payment.{" "}
        <button type="button" className="underline" onClick={() => void refetch()}>
          Try again
        </button>
      </div>
    );
  }
  // Loading and "none waiting" both render nothing: this is an optional notice
  // above the list, and a spinner here would flash on every visit to Posts.
  if (!data || data.length === 0) return null;

  const pay = async (row: PendingVisitPayment) => {
    if (inFlight.current) return;
    inFlight.current = true;
    setPayingId(row.id);
    try {
      const { data: res, error: fnErr } = await supabase.functions.invoke("create-payment", {
        body: { action: "recurring_visit", paymentId: row.id, native: isNativePlatform },
      });
      const url = res?.url as string | undefined;
      if (fnErr || res?.error || !url) {
        const message = (
          res?.error ||
          (fnErr ? await functionErrorMessage(fnErr, "Payment setup failed") : "Payment setup failed")
        ).replace(/[.\s]+$/, "");
        report(new Error(`recurring visit payment failed: ${message}`), {
          tags: { source: "RecurringVisitPayments" },
          context: { payment_id: row.id },
        });
        hapticError();
        toast.error(`Couldn't start payment: ${message}.`);
        void refetch();
        return;
      }
      await openExternalUrl(url, () => void refetch());
    } catch (err) {
      report(err, { tags: { source: "RecurringVisitPayments" }, context: { payment_id: row.id } });
      hapticError();
      toast.error("We couldn't set up payment just yet. Please try again.");
    } finally {
      inFlight.current = false;
      setPayingId(null);
    }
  };

  return (
    <section aria-label="Visits waiting on payment" className="flex flex-col gap-2">
      {data.map((row) => {
        const dollars = (row.amount_cents / 100).toFixed(2);
        const busy = payingId === row.id;
        return (
          <div key={row.id} className="rounded-ds-md border border-border bg-card p-3 flex flex-col gap-2">
            <div className="text-sm">
              <p className="font-semibold">Confirm your next visit</p>
              <p className="text-muted-foreground">
                {row.jobs?.title ? `"${row.jobs.title}"` : "Your repeating job"} on {row.visit_date} is ${dollars}.
                Payments this size need you to confirm them, so the visit is booked once you pay.
              </p>
            </div>
            <Button
              type="button"
              className="btn-grad-primary rounded-ds-md btn-press self-start"
              disabled={payingId !== null}
              onClick={() => void pay(row)}
            >
              {busy ? <Loader2 className="w-4 h-4 mr-1.5 animate-spin" /> : <CreditCard className="w-4 h-4 mr-1.5" />}
              Pay ${dollars}
            </Button>
          </div>
        );
      })}
    </section>
  );
}
