import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { DollarSign, Send, Clock, CheckCircle2, AlertTriangle, ListChecks } from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { formatName } from "@/lib/utils";
import { logAdminAction } from "@/lib/adminAudit";
import { useInstantQuery } from "@/hooks/useInstantQuery";
import { useAuthReady } from "@/hooks/useAuthReady";
import { queryKeys } from "@/lib/queryKeys";

interface PayoutBatch {
  helper_id: string;
  helper_name: string | null;
  helper_email: string | null;
  stripe_account_id: string | null;
  job_count: number;
  total_payout: number;
  oldest_completed_at: string;
}

interface PayoutLedgerRow {
  id: string;
  helper_id: string;
  amount_cents: number;
  platform_fee_cents: number;
  status: "pending" | "paid" | "failed" | "reversed";
  created_at: string;
  failure_reason: string | null;
  stripe_transfer_id: string | null;
  initiated_by: string | null;
  jobs: { title?: string } | null;
  profiles: { full_name?: string | null } | null;
}

const LEDGER_TONE: Record<string, string> = {
  paid: "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-300",
  pending: "bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300",
  failed: "bg-destructive/10 text-destructive",
  reversed: "bg-muted text-muted-foreground",
};

const AdminPayoutBatches = () => {
  const qc = useQueryClient();
  const { user } = useAuthReady();
  const adminId = user?.id;
  // Admin-scoped key: two admins on the same device should not share
  // cached views, and the persister must never surface the prior admin's
  // batch list to a different account on the next sign-in.
  const queryKey = ["admin-payout-batches", adminId] as const;
  const [paying, setPaying] = useState<string | null>(null);

  const { data: batches, isInitialLoading, isFetching } = useInstantQuery<PayoutBatch[]>({
    key: queryKey,
    fallback: [],
    enabled: !!adminId,
    // Admin batch list is high-sensitivity (every helper's pending payout
    // and email). Belt + suspenders: even though SIGNED_OUT wipes the
    // persisted cache, opt out of disk persistence entirely so this
    // never lands in IDB in the first place.
    meta: { persist: false },
    fetcher: async () => {
      const { data, error } = await supabase.rpc("get_payout_batches");
      if (error) {
        toast.error(error.message);
        return [];
      }
      return (data || []).map((r: any) => ({
        ...r,
        helper_name: formatName(r.helper_name, "Unknown"),
      }));
    },
  });

  // Recent transfer ledger — last 50 stripe.transfers.create() rows across
  // all helpers. helper_id FKs to auth.users (not profiles), so the helper
  // name is resolved via a second query and merged client-side.
  // Cast via `as any`: payout_transfers is in a recent migration not yet in
  // generated client types (full regen exceeds tooling output limits).
  const { data: ledger = [] } = useQuery<PayoutLedgerRow[]>({
    queryKey: queryKeys.admin.payoutLedger(adminId),
    enabled: !!adminId,
    // Admin-wide transfer ledger — opt out of disk persistence.
    meta: { persist: false },
    queryFn: async () => {
      const { data, error } = await supabase.from("payout_transfers")
        .select(
          "id, helper_id, amount_cents, platform_fee_cents, status, created_at, failure_reason, stripe_transfer_id, initiated_by, jobs(title)"
        )
        .order("created_at", { ascending: false })
        .limit(50);
      if (error) {
        toast.error(`Ledger: ${error.message}`);
        return [];
      }
      const rows = (data ?? []) as Omit<PayoutLedgerRow, "profiles">[];
      const helperIds = [...new Set(rows.map((r) => r.helper_id))];
      const { data: profileRows } = await supabase
        .from("profiles")
        .select("user_id, full_name")
        .in("user_id", helperIds);
      const nameMap = new Map((profileRows ?? []).map((p) => [p.user_id, p.full_name]));
      return rows.map((r) => ({
        ...r,
        profiles: { full_name: nameMap.get(r.helper_id) ?? null },
      }));
    },
    staleTime: 60_000,
    gcTime: 5 * 60_000,
  });

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
      qc.invalidateQueries({ queryKey });
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
          <h2 className="text-ds-20 font-display font-bold text-foreground flex items-center gap-2">
            <DollarSign className="w-5 h-5 text-primary" /> Payout Batches
          </h2>
          <p className="text-ds-11 text-muted-foreground mt-0.5">
            Helprs with completed jobs awaiting payout. Trigger Stripe transfers in bulk per helpr.
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={() => qc.invalidateQueries({ queryKey })} disabled={isFetching}>
          {isFetching ? "Refreshing…" : "Refresh"}
        </Button>
      </div>

      {batches.length > 0 && (
        <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
          <div className="rounded-ds-md liquid-glass p-4">
            <p className="text-ds-11 uppercase tracking-wider text-muted-foreground">Helprs awaiting</p>
            <p className="text-ds-24 font-bold text-foreground mt-1">{batches.length}</p>
          </div>
          <div className="rounded-ds-md liquid-glass p-4">
            <p className="text-ds-11 uppercase tracking-wider text-muted-foreground">Total jobs</p>
            <p className="text-ds-24 font-bold text-foreground mt-1">{totalJobs}</p>
          </div>
          <div className="rounded-ds-md border border-border bg-primary/5 p-4 col-span-2 md:col-span-1">
            <p className="text-ds-11 uppercase tracking-wider text-muted-foreground">Total queued</p>
            <p className="text-ds-24 font-bold text-primary mt-1">${grandTotal.toFixed(2)}</p>
          </div>
        </div>
      )}

      {isInitialLoading ? (
        <p className="text-ds-11 text-muted-foreground">Loading payout batches…</p>
      ) : batches.length === 0 ? (
        <div className="rounded-ds-md liquid-glass p-8 text-center">
          <CheckCircle2 className="w-8 h-8 text-primary mx-auto mb-2" />
          <p className="text-ds-11 text-muted-foreground">All payouts are settled. Nothing to send.</p>
        </div>
      ) : (
        <div className="space-y-2">
          {batches.map((batch) => {
            const ageDays = Math.floor((Date.now() - new Date(batch.oldest_completed_at).getTime()) / 86_400_000);
            const isStale = ageDays >= 3;
            return (
              <div key={batch.helper_id} className="rounded-ds-md liquid-glass p-4 flex flex-col sm:flex-row sm:items-center gap-3">
                <div className="flex-1 min-w-0 space-y-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-semibold text-ds-13 text-foreground truncate">{batch.helper_name}</span>
                    <Badge variant="secondary" className="text-ds-10">
                      {batch.job_count} job{batch.job_count > 1 ? "s" : ""}
                    </Badge>
                    {!batch.stripe_account_id && (
                      <Badge className="bg-destructive/10 text-destructive border-destructive/20 text-ds-10">
                        <AlertTriangle className="w-3 h-3 mr-0.5" /> No Stripe
                      </Badge>
                    )}
                    {isStale && (
                      <Badge className="bg-orange-100 text-orange-800 dark:bg-orange-900/30 dark:text-orange-300 text-ds-10">
                        <Clock className="w-3 h-3 mr-0.5" /> {ageDays}d old
                      </Badge>
                    )}
                  </div>
                  <p className="text-ds-11 text-muted-foreground">{batch.helper_email}</p>
                  <p className="text-ds-11 text-muted-foreground">
                    Oldest job: {formatDistanceToNow(new Date(batch.oldest_completed_at), { addSuffix: true })}
                  </p>
                </div>
                <div className="text-right shrink-0">
                  <p className="text-ds-17 font-bold text-primary">${Number(batch.total_payout).toFixed(2)}</p>
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

      {/* ─── Recent transfers ledger ─── */}
      {ledger.length > 0 && (
        <div className="space-y-3 pt-4 border-t border-border/50">
          <div className="flex items-center gap-2">
            <ListChecks className="w-4 h-4 text-primary" />
            <h3 className="text-ds-13 font-semibold text-foreground">Recent transfers</h3>
            <Badge variant="secondary" className="text-ds-10">last {ledger.length}</Badge>
          </div>
          <p className="text-ds-11 text-muted-foreground">
            Authoritative ledger from <code className="text-ds-10">payout_transfers</code>.
            Written by <code className="text-ds-10">release-payout</code> on every
            <code className="text-ds-10"> stripe.transfers.create()</code> call.
          </p>
          <div className="space-y-1.5">
            {ledger.map((t) => {
              const helperName = formatName(t.profiles?.full_name, "Unknown helpr");
              const jobTitle = t.jobs?.title ?? "—";
              const amount = (t.amount_cents / 100).toFixed(2);
              const fee = (t.platform_fee_cents / 100).toFixed(2);
              const tone = LEDGER_TONE[t.status] ?? "bg-muted text-muted-foreground";
              return (
                <div key={t.id} className="rounded-ds-sm liquid-glass p-3 flex items-start gap-3">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-medium text-ds-13 text-foreground truncate">{helperName}</span>
                      <Badge className={`${tone} text-ds-10 capitalize`}>{t.status}</Badge>
                      {t.initiated_by && t.initiated_by !== "system" && (
                        <Badge variant="outline" className="text-ds-10 capitalize">{t.initiated_by}</Badge>
                      )}
                    </div>
                    <p className="text-ds-11 text-muted-foreground mt-0.5 truncate">
                      {jobTitle}
                      {t.stripe_transfer_id && (
                        <span className="ml-2 font-mono opacity-60" title="Stripe transfer ID">
                          {t.stripe_transfer_id.slice(-8)}
                        </span>
                      )}
                    </p>
                    {t.failure_reason && t.status === "failed" && (
                      <p className="text-ds-11 text-destructive mt-0.5 break-words">{t.failure_reason}</p>
                    )}
                    <p className="text-ds-10 text-muted-foreground mt-0.5">
                      {formatDistanceToNow(new Date(t.created_at), { addSuffix: true })}
                    </p>
                  </div>
                  <div className="text-right shrink-0">
                    <p className="text-ds-13 font-semibold text-foreground tabular-nums">${amount}</p>
                    {Number(fee) > 0 && (
                      <p className="text-ds-10 text-muted-foreground">fee ${fee}</p>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
};

export default AdminPayoutBatches;
