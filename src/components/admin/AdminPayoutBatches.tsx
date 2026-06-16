import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { unwrap } from "@/lib/supabaseResult";
import { report } from "@/lib/errorLogger";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "sonner";
import { DollarSign, Send, Clock, CheckCircle2, AlertTriangle, ListChecks, Pause, Play } from "lucide-react";
import { Checkbox } from "@/components/ui/checkbox";
import { safeStorage } from "@/lib/safeStorage";
import { formatDistanceToNow } from "date-fns";
import { formatName } from "@/lib/utils";
import { logAdminAction } from "@/lib/adminAudit";
import { useInstantQuery } from "@/hooks/useInstantQuery";
import { useAuthReady } from "@/hooks/useAuthReady";
import { queryKeys } from "@/lib/queryKeys";
import { BrandConfirmDialog } from "@/components/ui/BrandConfirmDialog";
import { ErrorState } from "@/components/ui/ErrorState";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";

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

// Hold-for-review queue is stored client-side under a stable key so
// every admin sees the same list. Persisting it server-side would
// need a migration; for now the localStorage approach is enough since
// it's a small triage queue that admins clear as they go.
const HOLD_KEY = "helpr.admin_payout_holds.v1";
const loadHolds = (): Record<string, { reason: string; addedAt: string; addedBy?: string }> => {
  try {
    const raw = safeStorage.getItem(HOLD_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch { return {}; }
};
const saveHolds = (h: Record<string, { reason: string; addedAt: string; addedBy?: string }>) => {
  try { safeStorage.setItem(HOLD_KEY, JSON.stringify(h)); } catch { /* noop */ }
};

const AdminPayoutBatches = () => {
  const qc = useQueryClient();
  const { user } = useAuthReady();
  const adminId = user?.id;
  // Selection set for bulk payout. Persists across re-renders but is
  // intentionally not stored — refreshing clears the picks so a stale
  // selection can't fire a real transfer.
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkPaying, setBulkPaying] = useState(false);
  const [confirmBulk, setConfirmBulk] = useState(false);
  const [tab, setTab] = useState<"ready" | "hold">("ready");
  const [holds, setHolds] = useState<Record<string, { reason: string; addedAt: string; addedBy?: string }>>(() => loadHolds());
  const [holdReasonDraft, setHoldReasonDraft] = useState<{ helperId: string; reason: string } | null>(null);
  // Deny flow: required reason, seeded with the default the old
  // window.prompt offered so a one-tap deny still records a sensible note.
  const [denyDraft, setDenyDraft] = useState<{ helperId: string; reason: string } | null>(null);

  const updateHolds = (next: Record<string, { reason: string; addedAt: string; addedBy?: string }>) => {
    setHolds(next);
    saveHolds(next);
  };

  const addHold = (helperId: string, reason: string) => {
    const next = { ...holds, [helperId]: { reason, addedAt: new Date().toISOString(), addedBy: adminId } };
    updateHolds(next);
    setSelected((prev) => {
      const n = new Set(prev);
      n.delete(helperId);
      return n;
    });
    void logAdminAction("payout_held_for_review", "user", helperId, { reason });
  };
  const releaseHold = (helperId: string) => {
    const next = { ...holds };
    delete next[helperId];
    updateHolds(next);
    void logAdminAction("payout_hold_released", "user", helperId);
  };
  const denyHold = async (helperId: string, reason: string) => {
    // Denial just records the audit decision — it doesn't refund
    // anything yet, because we don't have a "deny payout" RPC. The
    // helper stays in the hold tab with the deny reason appended so
    // it's visible until manual cleanup.
    void logAdminAction("payout_denied", "user", helperId, { reason });
    const existing = holds[helperId];
    if (existing) {
      const next = { ...holds, [helperId]: { ...existing, reason: `[DENIED] ${reason}` } };
      updateHolds(next);
    }
  };
  // Admin-scoped key: two admins on the same device should not share
  // cached views, and the persister must never surface the prior admin's
  // batch list to a different account on the next sign-in.
  const queryKey = ["admin-payout-batches", adminId] as const;
  const [paying, setPaying] = useState<string | null>(null);
  const [confirmBatch, setConfirmBatch] = useState<PayoutBatch | null>(null);

  // unwrap() throws into React Query so a failed RPC flips isError on and
  // surfaces a recoverable retry instead of silently degrading to "all
  // settled". CLAUDE.md: "Never drop the Supabase `error`".
  const { data: batches, isInitialLoading, isFetching, isError, refetch } = useInstantQuery<PayoutBatch[]>({
    key: queryKey,
    fallback: [],
    enabled: !!adminId,
    // Admin batch list is high-sensitivity (every helper's pending payout
    // and email). Belt + suspenders: even though SIGNED_OUT wipes the
    // persisted cache, opt out of disk persistence entirely so this
    // never lands in IDB in the first place.
    meta: { persist: false },
    fetcher: async () => {
      const data = unwrap(await supabase.rpc("get_payout_batches"));
      return ((data ?? []) as any[]).map((r: any) => ({
        ...r,
        helper_name: formatName(r.helper_name, "Unknown"),
      })) as PayoutBatch[];
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
      // unwrap() lets a failed ledger fetch surface as the query's error
      // state — previously this silently rendered an empty ledger.
      const data = unwrap(
        await supabase.from("payout_transfers")
          .select(
            "id, helper_id, amount_cents, platform_fee_cents, status, created_at, failure_reason, stripe_transfer_id, initiated_by, jobs(title)"
          )
          .order("created_at", { ascending: false })
          .limit(50),
      );
      const rows = (data ?? []) as Omit<PayoutLedgerRow, "profiles">[];
      const helperIds = [...new Set(rows.map((r) => r.helper_id))];
      const profileRows = unwrap(
        await supabase
          .from("profiles")
          .select("user_id, full_name")
          .in("user_id", helperIds),
      );
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
      report(err, { tags: { source: "AdminPayoutBatches.triggerPayout" } });
      toast.error(err.message || "Failed to trigger payout");
    } finally {
      setPaying(null);
    }
  };

  const readyBatches = batches.filter((b) => !holds[b.helper_id]);
  const heldBatches = batches.filter((b) => holds[b.helper_id]);
  const visibleBatches = tab === "ready" ? readyBatches : heldBatches;

  const grandTotal = readyBatches.reduce((s, b) => s + Number(b.total_payout || 0), 0);
  const totalJobs = readyBatches.reduce((s, b) => s + b.job_count, 0);

  // Bulk amounts — recomputed off the live selection.
  const selectedBatches = readyBatches.filter((b) => selected.has(b.helper_id) && b.stripe_account_id);
  const selectedTotal = selectedBatches.reduce((s, b) => s + Number(b.total_payout || 0), 0);

  const toggleSelected = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };
  const selectAllReady = () => {
    const all = readyBatches.filter((b) => b.stripe_account_id).map((b) => b.helper_id);
    setSelected(new Set(all));
  };
  const clearSelection = () => setSelected(new Set());

  const triggerBulkPayout = async () => {
    setBulkPaying(true);
    setConfirmBulk(false);
    let okCount = 0;
    let failCount = 0;
    for (const batch of selectedBatches) {
      try {
        const { error } = await supabase.functions.invoke("stripe-payouts", {
          body: { helper_id: batch.helper_id },
        });
        if (error) throw error;
        await logAdminAction("trigger_payout", "user", batch.helper_id, {
          job_count: batch.job_count,
          total_payout: batch.total_payout,
          bulk: true,
        });
        okCount += 1;
      } catch (err: any) {
        failCount += 1;
        report(err, { tags: { source: "AdminPayoutBatches.triggerBulkPayout" } });
        toast.error(`${batch.helper_name}: ${err?.message || "Failed"}`);
      }
    }
    setBulkPaying(false);
    setSelected(new Set());
    qc.invalidateQueries({ queryKey });
    if (okCount > 0) toast.success(`Bulk payout: ${okCount} queued${failCount > 0 ? `, ${failCount} failed` : ""}`);
  };

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

      {/* Tabs — Ready vs Hold for Review. Held batches sit in their own
          queue so they don't sneak into a bulk select. */}
      {batches.length > 0 && (
        <div className="flex gap-1.5 border-b border-border">
          <button
            type="button"
            onClick={() => { setTab("ready"); clearSelection(); }}
            className={`pb-2 px-3 -mb-px text-ds-13 font-medium border-b-2 transition-colors ${
              tab === "ready" ? "border-primary text-foreground" : "border-transparent text-muted-foreground hover:text-foreground"
            }`}
          >
            <span className="inline-flex items-center gap-1.5">
              <Send className="w-3.5 h-3.5" /> Ready
              <span className="text-ds-11 tabular-nums">({readyBatches.length})</span>
            </span>
          </button>
          <button
            type="button"
            onClick={() => { setTab("hold"); clearSelection(); }}
            className={`pb-2 px-3 -mb-px text-ds-13 font-medium border-b-2 transition-colors ${
              tab === "hold" ? "border-primary text-foreground" : "border-transparent text-muted-foreground hover:text-foreground"
            }`}
          >
            <span className="inline-flex items-center gap-1.5">
              <Pause className="w-3.5 h-3.5" /> Hold for review
              <span className="text-ds-11 tabular-nums">({heldBatches.length})</span>
            </span>
          </button>
        </div>
      )}

      {tab === "ready" && readyBatches.length > 0 && (
        <div className="flex items-center justify-between text-ds-11 px-1">
          <button type="button" onClick={selectAllReady} className="text-primary hover:underline">
            Select all with Stripe ({readyBatches.filter((b) => b.stripe_account_id).length})
          </button>
          {selected.size > 0 && (
            <button type="button" onClick={clearSelection} className="text-muted-foreground hover:text-foreground">
              Clear selection
            </button>
          )}
        </div>
      )}

      {isInitialLoading ? (
        // Skeleton rows give the page a stable shape while the RPC resolves
        // instead of dropping to a lone "Loading…" line.
        <div className="space-y-2" aria-hidden="true">
          {[0, 1, 2].map((i) => (
            <div key={i} className="rounded-ds-md liquid-glass p-4 flex items-center gap-3">
              <div className="flex-1 space-y-2">
                <Skeleton className="h-4 w-2/5" />
                <Skeleton className="h-3 w-1/3" />
              </div>
              <Skeleton className="h-6 w-24" />
            </div>
          ))}
        </div>
      ) : isError ? (
        <ErrorState
          variant="inline"
          title="We couldn't load payout batches."
          body="Tap Try again. No transfers were fired — the queue is server-side."
          onRetry={() => refetch()}
        />
      ) : visibleBatches.length === 0 ? (
        <div className="rounded-ds-md liquid-glass p-8 text-center">
          <CheckCircle2 className="w-8 h-8 text-primary mx-auto mb-2" />
          <p className="text-ds-11 text-muted-foreground">
            {tab === "ready" ? "All payouts are settled. Nothing to send." : "No payouts are currently on hold."}
          </p>
        </div>
      ) : (
        <div className={`space-y-2 ${selected.size > 0 ? "pb-24" : ""}`}>
          {visibleBatches.map((batch) => {
            const ageDays = Math.floor((Date.now() - new Date(batch.oldest_completed_at).getTime()) / 86_400_000);
            const isStale = ageDays >= 3;
            const hold = holds[batch.helper_id];
            const isHeld = !!hold;
            return (
              <div key={batch.helper_id} className="rounded-ds-md liquid-glass p-4 flex flex-col sm:flex-row sm:items-center gap-3">
                {tab === "ready" && batch.stripe_account_id && (
                  <Checkbox
                    checked={selected.has(batch.helper_id)}
                    onCheckedChange={() => toggleSelected(batch.helper_id)}
                    aria-label={`Select ${batch.helper_name} for bulk payout`}
                    className="mt-0.5"
                  />
                )}
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
                    {isHeld && (
                      <Badge className="bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300 text-ds-10">
                        <Pause className="w-3 h-3 mr-0.5" /> On hold
                      </Badge>
                    )}
                  </div>
                  <p className="text-ds-11 text-muted-foreground">{batch.helper_email}</p>
                  <p className="text-ds-11 text-muted-foreground">
                    Oldest job: {formatDistanceToNow(new Date(batch.oldest_completed_at), { addSuffix: true })}
                  </p>
                  {isHeld && hold.reason && (
                    <p className="text-ds-11 text-amber-700 dark:text-amber-300 italic mt-1">
                      Hold reason: {hold.reason}
                    </p>
                  )}
                </div>
                <div className="text-right shrink-0 space-y-1">
                  <p className="text-ds-17 font-bold text-primary">${Number(batch.total_payout).toFixed(2)}</p>
                  {tab === "ready" ? (
                    <div className="flex gap-1.5 justify-end flex-wrap">
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => setHoldReasonDraft({ helperId: batch.helper_id, reason: "" })}
                        className="gap-1"
                      >
                        <Pause className="w-3 h-3" /> Hold
                      </Button>
                      <Button
                        size="sm"
                        disabled={paying === batch.helper_id || !batch.stripe_account_id}
                        onClick={() => setConfirmBatch(batch)}
                      >
                        <Send className="w-3 h-3 mr-1" />
                        {paying === batch.helper_id ? "Sending…" : "Pay out"}
                      </Button>
                    </div>
                  ) : (
                    <div className="flex gap-1.5 justify-end flex-wrap">
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => releaseHold(batch.helper_id)}
                        className="gap-1"
                      >
                        <Play className="w-3 h-3" /> Release
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        className="text-destructive border-destructive/40 hover:bg-destructive/10 gap-1"
                        onClick={() => setDenyDraft({ helperId: batch.helper_id, reason: "Compliance review failed" })}
                      >
                        Deny
                      </Button>
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Sticky bulk action bar — sits above the bottom nav (which itself
          honours the iOS safe-area inset) while a selection is active. */}
      {tab === "ready" && selected.size > 0 && (
        <div
          className="fixed left-0 right-0 z-40 px-4 py-3 bg-background/95 backdrop-blur border-t border-border shadow-[0_-4px_12px_-4px_rgba(0,0,0,0.08)]"
          style={{
            bottom: "calc(env(safe-area-inset-bottom, 0px) + 4.5rem)",
          }}
        >
          <div className="max-w-2xl mx-auto flex items-center gap-3 flex-wrap">
            <div className="flex-1 min-w-[160px]">
              <p className="text-ds-13 font-semibold text-foreground">
                {selected.size} helper{selected.size > 1 ? "s" : ""} selected
              </p>
              <p className="text-ds-11 text-muted-foreground tabular-nums">
                ${selectedTotal.toFixed(2)} total — fires {selected.size} Stripe transfer{selected.size > 1 ? "s" : ""}
              </p>
            </div>
            <Button variant="ghost" size="sm" onClick={clearSelection}>Clear</Button>
            <Button size="sm" onClick={() => setConfirmBulk(true)} disabled={bulkPaying || selected.size === 0}>
              <Send className="w-3 h-3 mr-1" />
              {bulkPaying ? "Queuing…" : "Bulk approve"}
            </Button>
          </div>
        </div>
      )}

      {/* Hold dialog — captures the reason that surfaces on the row + audit. */}
      <Dialog open={!!holdReasonDraft} onOpenChange={(o) => { if (!o) setHoldReasonDraft(null); }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="font-display flex items-center gap-2">
              <Pause className="w-5 h-5 text-amber-600" /> Hold payout for review
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <p className="text-ds-11 text-muted-foreground">
              Moves this helper's batch to the Hold-for-review queue. No
              Stripe transfer is fired. Logged to admin_audit_log.
            </p>
            <Textarea
              placeholder="Reason — visible to other admins reviewing the queue."
              value={holdReasonDraft?.reason ?? ""}
              onChange={(e) => holdReasonDraft && setHoldReasonDraft({ ...holdReasonDraft, reason: e.target.value })}
              rows={3}
            />
          </div>
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setHoldReasonDraft(null)}>Cancel</Button>
            <Button
              onClick={() => {
                if (!holdReasonDraft) return;
                addHold(holdReasonDraft.helperId, holdReasonDraft.reason.trim() || "No reason given");
                setHoldReasonDraft(null);
              }}
              disabled={!holdReasonDraft?.reason.trim()}
            >
              Hold for review
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!denyDraft} onOpenChange={(o) => { if (!o) setDenyDraft(null); }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="font-display flex items-center gap-2">
              <AlertTriangle className="w-5 h-5 text-destructive" /> Deny this payout
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <p className="text-ds-11 text-muted-foreground">
              Records the denial decision to admin_audit_log and tags the
              hold as denied. No Stripe transfer is fired or reversed.
            </p>
            <Textarea
              placeholder="Reason for denying this payout."
              value={denyDraft?.reason ?? ""}
              onChange={(e) => denyDraft && setDenyDraft({ ...denyDraft, reason: e.target.value })}
              rows={3}
            />
          </div>
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setDenyDraft(null)}>Cancel</Button>
            <Button
              variant="destructive"
              onClick={() => {
                if (!denyDraft) return;
                const reason = denyDraft.reason.trim();
                if (!reason) return;
                void denyHold(denyDraft.helperId, reason);
                setDenyDraft(null);
              }}
              disabled={!denyDraft?.reason.trim()}
            >
              Deny payout
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <BrandConfirmDialog
        open={confirmBulk}
        onOpenChange={(open) => { if (!open) setConfirmBulk(false); }}
        title="Bulk approve these payouts?"
        description={`This fires ${selected.size} Stripe transfer${selected.size > 1 ? "s" : ""} totalling $${selectedTotal.toFixed(2)}. This moves real money and can't be undone here.`}
        primaryLabel={bulkPaying ? "Queuing…" : `Send ${selected.size}`}
        primaryTone="sienna"
        primaryHaptic="warning"
        primaryDisabled={bulkPaying}
        onPrimary={(e) => {
          e.preventDefault();
          void triggerBulkPayout();
        }}
        secondaryLabel="Cancel"
      />

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

      <BrandConfirmDialog
        open={!!confirmBatch}
        onOpenChange={(open) => { if (!open) setConfirmBatch(null); }}
        title="Send this payout?"
        description={
          confirmBatch
            ? `This transfers $${Number(confirmBatch.total_payout).toFixed(2)} to ${confirmBatch.helper_name} for ${confirmBatch.job_count} job${confirmBatch.job_count > 1 ? "s" : ""} via Stripe. This moves real money and can't be undone here.`
            : ""
        }
        primaryLabel={confirmBatch && paying === confirmBatch.helper_id ? "Sending…" : "Send payout"}
        primaryTone="sienna"
        primaryHaptic="warning"
        primaryDisabled={!!paying}
        onPrimary={(e) => {
          e.preventDefault();
          if (!confirmBatch) return;
          const batch = confirmBatch;
          setConfirmBatch(null);
          triggerPayout(batch);
        }}
        secondaryLabel="Cancel"
      />
    </div>
  );
};

export default AdminPayoutBatches;
