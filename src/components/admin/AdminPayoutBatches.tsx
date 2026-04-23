import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { DollarSign, Send, Clock, CheckCircle2, AlertTriangle } from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { formatName } from "@/lib/utils";
import { logAdminAction } from "@/lib/adminAudit";

interface PayoutBatch {
  helper_id: string;
  helper_name: string | null;
  helper_email: string | null;
  stripe_account_id: string | null;
  job_count: number;
  total_payout: number;
  oldest_completed_at: string;
}

const AdminPayoutBatches = () => {
  const [batches, setBatches] = useState<PayoutBatch[]>([]);
  const [loading, setLoading] = useState(true);
  const [paying, setPaying] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    const { data, error } = await (supabase.rpc as any)("get_payout_batches");
    if (error) {
      toast.error(error.message);
      setBatches([]);
    } else {
      setBatches((data || []).map((r: any) => ({
        ...r,
        helper_name: formatName(r.helper_name, "Unknown"),
      })));
    }
    setLoading(false);
  };

  useEffect(() => { load(); }, []);

  const triggerPayout = async (batch: PayoutBatch) => {
    if (!batch.stripe_account_id) {
      toast.error(`${batch.helper_name} has no Stripe payout account configured.`);
      return;
    }
    setPaying(batch.helper_id);
    try {
      const { error } = await supabase.functions.invoke("stripe-payouts", {
        body: { helper_id: batch.helper_id },
      });
      if (error) throw error;
      toast.success(`Payout queued for ${batch.helper_name}`);
      await logAdminAction("trigger_payout", "user", batch.helper_id, {
        job_count: batch.job_count,
        total_payout: batch.total_payout,
      });
      await load();
    } catch (err: any) {
      toast.error(err.message || "Failed to trigger payout");
    } finally {
      setPaying(null);
    }
  };

  const grandTotal = batches.reduce((s, b) => s + Number(b.total_payout || 0), 0);
  const totalJobs = batches.reduce((s, b) => s + b.job_count, 0);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h2 className="text-xl font-display font-bold text-foreground flex items-center gap-2">
            <DollarSign className="w-5 h-5 text-primary" /> Payout Batches
          </h2>
          <p className="text-xs text-muted-foreground mt-0.5">
            Helprs with completed jobs awaiting payout. Trigger Stripe transfers in bulk per helpr.
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={load} disabled={loading}>
          {loading ? "Refreshing…" : "Refresh"}
        </Button>
      </div>

      {!loading && batches.length > 0 && (
        <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
          <div className="rounded-xl border border-border bg-card p-4">
            <p className="text-[11px] uppercase tracking-wider text-muted-foreground">Helprs awaiting</p>
            <p className="text-2xl font-bold text-foreground mt-1">{batches.length}</p>
          </div>
          <div className="rounded-xl border border-border bg-card p-4">
            <p className="text-[11px] uppercase tracking-wider text-muted-foreground">Total jobs</p>
            <p className="text-2xl font-bold text-foreground mt-1">{totalJobs}</p>
          </div>
          <div className="rounded-xl border border-border bg-primary/5 p-4 col-span-2 md:col-span-1">
            <p className="text-[11px] uppercase tracking-wider text-muted-foreground">Total queued</p>
            <p className="text-2xl font-bold text-primary mt-1">${grandTotal.toFixed(2)}</p>
          </div>
        </div>
      )}

      {loading ? (
        <p className="text-sm text-muted-foreground">Loading payout batches…</p>
      ) : batches.length === 0 ? (
        <div className="rounded-xl border border-border bg-card p-8 text-center">
          <CheckCircle2 className="w-8 h-8 text-primary mx-auto mb-2" />
          <p className="text-sm text-muted-foreground">All payouts are settled. Nothing to send.</p>
        </div>
      ) : (
        <div className="space-y-2">
          {batches.map((batch) => {
            const ageDays = Math.floor((Date.now() - new Date(batch.oldest_completed_at).getTime()) / 86_400_000);
            const isStale = ageDays >= 3;
            return (
              <div key={batch.helper_id} className="rounded-xl border border-border bg-card p-4 flex flex-col sm:flex-row sm:items-center gap-3">
                <div className="flex-1 min-w-0 space-y-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-semibold text-sm text-foreground truncate">{batch.helper_name}</span>
                    <Badge variant="secondary" className="text-[10px]">
                      {batch.job_count} job{batch.job_count > 1 ? "s" : ""}
                    </Badge>
                    {!batch.stripe_account_id && (
                      <Badge className="bg-destructive/10 text-destructive border-destructive/20 text-[10px]">
                        <AlertTriangle className="w-3 h-3 mr-0.5" /> No Stripe
                      </Badge>
                    )}
                    {isStale && (
                      <Badge className="bg-orange-100 text-orange-800 dark:bg-orange-900/30 dark:text-orange-300 text-[10px]">
                        <Clock className="w-3 h-3 mr-0.5" /> {ageDays}d old
                      </Badge>
                    )}
                  </div>
                  <p className="text-xs text-muted-foreground">{batch.helper_email}</p>
                  <p className="text-[11px] text-muted-foreground">
                    Oldest job: {formatDistanceToNow(new Date(batch.oldest_completed_at), { addSuffix: true })}
                  </p>
                </div>
                <div className="text-right shrink-0">
                  <p className="text-lg font-bold text-primary">${Number(batch.total_payout).toFixed(2)}</p>
                  <Button
                    size="sm"
                    className="mt-1"
                    disabled={paying === batch.helper_id || !batch.stripe_account_id}
                    onClick={() => triggerPayout(batch)}
                  >
                    <Send className="w-3 h-3 mr-1" />
                    {paying === batch.helper_id ? "Sending…" : "Pay out"}
                  </Button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};

export default AdminPayoutBatches;
