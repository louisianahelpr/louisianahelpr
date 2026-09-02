import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { unwrap } from "@/lib/supabaseResult";
import { report } from "@/lib/errorLogger";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "sonner";
import { Send, CheckCircle2, Pause } from "lucide-react";
import { formatName } from "@/lib/utils";
import { logAdminAction } from "@/lib/adminAudit";
import { useInstantQuery } from "@/hooks/useInstantQuery";
import { useAuthReady } from "@/hooks/useAuthReady";
import { queryKeys } from "@/lib/queryKeys";
import { BrandConfirmDialog } from "@/components/ui/BrandConfirmDialog";
import { ErrorState } from "@/components/ui/ErrorState";
import { EmptyState } from "@/components/ui/EmptyState";
import { AdminViewShell, AdminCard } from "@/components/admin/AdminViewShell";
import { formatPriceExact } from "@/lib/format";
import {
  Dialog,
  DialogContent,
  DialogHero,
  DialogBody,
  DialogFooter,
  DialogSecondaryAction,
  DialogPrimaryAction,
  DialogDestructiveAction,
} from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import type { PayoutBatch, PayoutLedgerRow } from "./adminPayoutBatches/types";
import { loadHolds, saveHolds } from "./adminPayoutBatches/adminPayoutBatchesHelpers";
import { BatchRow } from "./adminPayoutBatches/BatchRow";
import { LedgerList } from "./adminPayoutBatches/LedgerList";
import { NESTED_EMPTY_SURFACE } from "@/components/admin/adminEmptyState";
import { requireBiometric } from "@/lib/biometricGate";

/**
 * Guard against a SILENT NO-OP on the money path.
 *
 * "Send Payout" and "Bulk Approve" invoke the `stripe-payouts` edge function
 * with `{ helper_id }`. That function never reads `helper_id`, and it never
 * calls `stripe.transfers.create` — it looks up THE CALLER'S OWN
 * `profiles.stripe_account_id` and returns a read-only Connect balance summary
 * (`{ connected, payouts_enabled, available, pending, payouts }`). It is the
 * same endpoint a Helpr's own Earnings tab calls with an empty body.
 *
 * An admin has no `stripe_account_id`, so the function returns
 * `{ connected:false, payouts:[] }` with HTTP 200 and NO `error` field. The old
 * code's `if (error) throw error` therefore never fired: after a Face ID
 * prompt and a confirm dialog reading "This moves real money and can't be
 * undone", the UI wrote an `admin_audit_log` row claiming the payout was
 * triggered, closed the dialog, and moved on — while zero cents moved and the
 * batch stayed in the queue.
 *
 * Until the backend gains a real admin batch-payout endpoint (the working
 * per-job transfer lives in the `release-payout` function, which takes a
 * `job_id`; `get_payout_batches()` does not currently return job ids, so the
 * client cannot call it), this makes the no-op LOUD instead of silent: the
 * admin sees a real error and the audit log is not falsified.
 */
function assertTransferHappened(data: unknown): void {
  const d = data as Record<string, unknown> | null | undefined;
  if (d && ("connected" in d || "payouts_enabled" in d)) {
    throw new Error(
      "Payout not sent. The endpoint this button calls only reads a Connect balance — it never creates a transfer, so no money moved. Escrow release still runs automatically; this batch is unchanged.",
    );
  }
}

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
      return (data ?? []).map((r) => ({
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
    // Face ID / Touch ID gate: this pushes a real Stripe payout out of the
    // platform balance. Irreversible once the transfer lands. Runs after the
    // no-Stripe-account guard so a blocked payout never raises an OS prompt.
    // No-op on web and on devices without enrolled biometrics.
    const ok = await requireBiometric(`Confirm the payout to ${batch.helper_name}`);
    if (!ok) return;
    setPaying(batch.helper_id);
    try {
      // `release-payout` is what actually transfers, and it takes a JOB id.
      // get_payout_batches() aggregates by helper and returns no job ids,
      // which is why the old call went to `stripe-payouts` — a function that
      // never reads helper_id and only reports the CALLER's own balance. It
      // answered 200 with no `error`, so this handler logged a payout that
      // never happened. get_payout_batch_job_ids (20260831213026) shares that
      // RPC's predicate exactly, so what we pay is what the batch counted.
      // Cast through `never`: src/integrations/supabase/types.ts is a SNAPSHOT
      // regenerated from the database, and get_payout_batch_job_ids landed in
      // 20260831213026 after the last regeneration. The RPC is live in prod
      // (verified), the types simply have not caught up — the same deploy-lag
      // window CLAUDE.md documents for brand-new RPCs. Drop the cast once
      // types.ts is regenerated.
      const { data: jobRows, error: jobsErr } = await supabase.rpc(
        "get_payout_batch_job_ids" as never,
        { p_helper_id: batch.helper_id } as never,
      );
      if (jobsErr) throw jobsErr;
      const jobIds = ((jobRows ?? []) as Array<{ job_id: string }>).map((r) => r.job_id);
      if (jobIds.length === 0) {
        // Zero rows is also what a non-admin sees, by design in the RPC.
        throw new Error(
          "Nothing left to pay in this batch — it may have settled already. Refresh to re-check.",
        );
      }

      // One job at a time, and a partial success is reported as one. The claim
      // protocol in release-payout means a job already paid answers cleanly
      // rather than double-paying, so a retry after a partial failure is safe.
      const failures: string[] = [];
      for (const jobId of jobIds) {
        const { data, error } = await supabase.functions.invoke("release-payout", {
          body: { job_id: jobId },
        });
        if (error) { failures.push(jobId); continue; }
        try { assertTransferHappened(data); } catch { failures.push(jobId); }
      }

      const paid = jobIds.length - failures.length;
      // Log what ACTUALLY moved, not what was attempted. The whole reason this
      // path is being rewritten is that the audit log recorded a payout that
      // never happened.
      if (paid > 0) {
        await logAdminAction("trigger_payout", "user", batch.helper_id, {
          jobs_attempted: jobIds.length,
          jobs_paid: paid,
          jobs_failed: failures.length,
          total_payout: batch.total_payout,
        });
      }
      if (failures.length > 0) {
        throw new Error(
          `Paid ${paid} of ${jobIds.length}. ${failures.length} could not be released — ` +
            `they stay in the batch, and retrying is safe.`,
        );
      }
      qc.invalidateQueries({ queryKey });
    } catch (err: unknown) {
      report(err, { tags: { source: "AdminPayoutBatches.triggerPayout" } });
      toast.error(err instanceof Error ? err.message : "Couldn't trigger that payout — try again");
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
    setConfirmBulk(false);
    // Face ID / Touch ID gate: ONE prompt for the whole selection, before the
    // loop — never per-helper, which would be unusable on a 40-batch run and
    // would train admins to blow through prompts. Irreversible money movement.
    // No-op on web and on devices without enrolled biometrics.
    const ok = await requireBiometric("Confirm this bulk payout run");
    if (!ok) return;
    setBulkPaying(true);
    for (const batch of selectedBatches) {
      try {
        const { data, error } = await supabase.functions.invoke("stripe-payouts", {
          body: { helper_id: batch.helper_id },
        });
        if (error) throw error;
        assertTransferHappened(data);
        await logAdminAction("trigger_payout", "user", batch.helper_id, {
          job_count: batch.job_count,
          total_payout: batch.total_payout,
          bulk: true,
        });
      } catch (err: unknown) {
        report(err, { tags: { source: "AdminPayoutBatches.triggerBulkPayout" } });
        toast.error(`Couldn't process the payout for ${batch.helper_name} — try again?`);
      }
    }
    setBulkPaying(false);
    setSelected(new Set());
    qc.invalidateQueries({ queryKey });
  };

  return (
    <AdminViewShell>
      {/* One card owns the whole queue: the lead sentence is its subtitle,
          Refresh is its header action (it was previously stranded beside that
          sentence on a bare row), and the totals, tabs and rows are its body.
          Money screens are where "which control belongs to which list?" is
          least safe to leave ambiguous. */}
      <AdminCard
        title="Payout Queue"
        subtitle="Completed jobs awaiting a Stripe transfer, batched per Helpr."
        action={
          <Button variant="outline" size="sm" onClick={() => qc.invalidateQueries({ queryKey })} disabled={isFetching}>
            {isFetching ? "Refreshing…" : "Refresh"}
          </Button>
        }
        contentClassName="space-y-4"
      >
      {batches.length > 0 && (
        <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
          <div className="rounded-ds-md border border-border/60 bg-background/40 p-4">
            <p className="text-ds-11 uppercase tracking-wider text-muted-foreground">Helprs awaiting</p>
            <p className="text-ds-24 font-bold text-foreground mt-1">{batches.length}</p>
          </div>
          <div className="rounded-ds-md border border-border/60 bg-background/40 p-4">
            <p className="text-ds-11 uppercase tracking-wider text-muted-foreground">Total jobs</p>
            <p className="text-ds-24 font-bold text-foreground mt-1">{totalJobs}</p>
          </div>
          <div className="rounded-ds-md border border-border bg-primary/5 p-4 col-span-2 md:col-span-1">
            <p className="text-ds-11 uppercase tracking-wider text-muted-foreground">Total queued</p>
            <p className="text-ds-24 font-bold text-primary mt-1">${formatPriceExact(grandTotal)}</p>
          </div>
        </div>
      )}

      {/* Tabs — Ready vs Hold for Review. Held batches sit in their own
          queue so they don't sneak into a bulk select. NOTE: holds live in
          localStorage (see adminPayoutBatchesHelpers), so they are scoped to
          THIS browser — the tab label says so, because a second admin sees an
          unheld batch with a live Pay Out button. */}
      {batches.length > 0 && (
        <div role="tablist" aria-label="Payout queue" className="flex gap-1.5 border-b border-border">
          <button
            type="button"
            role="tab"
            aria-selected={tab === "ready"}
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
            role="tab"
            aria-selected={tab === "hold"}
            onClick={() => { setTab("hold"); clearSelection(); }}
            className={`pb-2 px-3 -mb-px text-ds-13 font-medium border-b-2 transition-colors ${
              tab === "hold" ? "border-primary text-foreground" : "border-transparent text-muted-foreground hover:text-foreground"
            }`}
          >
            <span className="inline-flex items-center gap-1.5">
              <Pause className="w-3.5 h-3.5" /> Hold for Review
              <span className="text-ds-10 font-normal text-muted-foreground">(this device)</span>
              <span className="text-ds-11 tabular-nums">({heldBatches.length})</span>
            </span>
          </button>
        </div>
      )}

      {tab === "ready" && readyBatches.length > 0 && (
        <div className="flex items-center justify-between text-ds-11 px-1">
          <button type="button" onClick={selectAllReady} className="text-primary hover:underline">
            Select All with Stripe ({readyBatches.filter((b) => b.stripe_account_id).length})
          </button>
          {selected.size > 0 && (
            <button type="button" onClick={clearSelection} className="text-muted-foreground hover:text-foreground">
              Clear Selection
            </button>
          )}
        </div>
      )}

      {isInitialLoading ? (
        // Skeleton rows give the page a stable shape while the RPC resolves
        // instead of dropping to a lone "Loading…" line.
        <div className="space-y-2" aria-hidden="true">
          {[0, 1, 2].map((i) => (
            <div key={i} className="rounded-ds-md border border-border/60 bg-background/40 p-4 flex items-center gap-3">
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
          surfaceStyle={NESTED_EMPTY_SURFACE}
          variant="inline"
          title="We couldn't load payout batches."
          body="Tap Try again. No transfers were fired — the queue is server-side."
          onRetry={() => refetch()}
        />
      ) : visibleBatches.length === 0 ? (
        /* The shared EmptyState. This screen hand-rolled an icon over a grey
           line, so the money queue — the one an admin most needs to trust —
           was the one that didn't look like the rest of the console. */
        <EmptyState
          surfaceStyle={NESTED_EMPTY_SURFACE}
          variant="inline"
          icon={CheckCircle2}
          title={tab === "ready" ? "Nothing to send" : "Nothing on hold"}
          body={
          tab === "ready"
          ? "Every payout is settled. Completed jobs queue here for transfer."
          : "No payouts are currently held for review."
          }
        />
      ) : (
        <div className={`space-y-2 ${selected.size > 0 ? "pb-24" : ""}`}>
          {visibleBatches.map((batch) => (
            <BatchRow
              key={batch.helper_id}
              batch={batch}
              tab={tab}
              hold={holds[batch.helper_id]}
              isSelected={selected.has(batch.helper_id)}
              paying={paying}
              onToggleSelected={toggleSelected}
              onHold={(b) => setHoldReasonDraft({ helperId: b.helper_id, reason: "" })}
              onPay={(b) => setConfirmBatch(b)}
              onRelease={releaseHold}
              onDeny={(b) => setDenyDraft({ helperId: b.helper_id, reason: "Compliance review failed" })}
            />
          ))}
        </div>
      )}
      </AdminCard>

      {/* Sticky bulk action bar — sits above the bottom nav (which itself
          honours the iOS safe-area inset) while a selection is active. */}
      {tab === "ready" && selected.size > 0 && (
        <div
          className="fixed left-0 right-0 z-40 px-4 py-3 bg-background/95 backdrop-blur border-t border-border shadow-[0_-4px_12px_-4px_rgba(0,0,0,0.08)]"
          style={{
            bottom: "calc(var(--safe-area-bottom, 0px) + 4.5rem)",
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
              {bulkPaying ? "Queuing…" : "Bulk Approve"}
            </Button>
          </div>
        </div>
      )}

      {/* Hold dialog — captures the reason that surfaces on the row + audit. */}
      <Dialog open={!!holdReasonDraft} onOpenChange={(o) => { if (!o) setHoldReasonDraft(null); }}>
        <DialogContent>
          <DialogHero
            title="Hold Payout for Review"
          />
          <div className="space-y-3">
            <DialogBody>
              <p>
                Moves this helper's batch to the Hold-for-review queue. No
                Stripe transfer is fired. Logged to admin_audit_log.
              </p>
            </DialogBody>
            <Textarea
              aria-label="Hold reason"
              placeholder="Reason — visible to other admins reviewing the queue."
              value={holdReasonDraft?.reason ?? ""}
              onChange={(e) => holdReasonDraft && setHoldReasonDraft({ ...holdReasonDraft, reason: e.target.value })}
              rows={3}
            />
          </div>
          <DialogFooter>
            <DialogSecondaryAction onClick={() => setHoldReasonDraft(null)}>Cancel</DialogSecondaryAction>
            <DialogPrimaryAction
              onClick={() => {
                if (!holdReasonDraft) return;
                addHold(holdReasonDraft.helperId, holdReasonDraft.reason.trim() || "No reason given");
                setHoldReasonDraft(null);
              }}
              disabled={!holdReasonDraft?.reason.trim()}
            >
              Hold for Review
            </DialogPrimaryAction>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!denyDraft} onOpenChange={(o) => { if (!o) setDenyDraft(null); }}>
        <DialogContent>
          <DialogHero
            title="Deny This Payout"
          />
          <div className="space-y-3">
            <DialogBody>
              <p>
                Records the denial decision to admin_audit_log and tags the
                hold as denied. No Stripe transfer is fired or reversed.
              </p>
            </DialogBody>
            <Textarea
              aria-label="Denial reason"
              value={denyDraft?.reason ?? ""}
              onChange={(e) => denyDraft && setDenyDraft({ ...denyDraft, reason: e.target.value })}
              rows={3}
            />
          </div>
          <DialogFooter>
            <DialogSecondaryAction onClick={() => setDenyDraft(null)}>Cancel</DialogSecondaryAction>
            <DialogDestructiveAction
              onClick={() => {
                if (!denyDraft) return;
                const reason = denyDraft.reason.trim();
                if (!reason) return;
                void denyHold(denyDraft.helperId, reason);
                setDenyDraft(null);
              }}
              disabled={!denyDraft?.reason.trim()}
            >
              Deny Payout
            </DialogDestructiveAction>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <BrandConfirmDialog
        open={confirmBulk}
        onOpenChange={(open) => { if (!open) setConfirmBulk(false); }}
        title="Bulk Approve These Payouts?"
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

      <LedgerList ledger={ledger} />

      <BrandConfirmDialog
        open={!!confirmBatch}
        onOpenChange={(open) => { if (!open) setConfirmBatch(null); }}
        title="Send This Payout?"
        description={
          confirmBatch
            ? `This transfers $${Number(confirmBatch.total_payout).toFixed(2)} to ${confirmBatch.helper_name} for ${confirmBatch.job_count} job${confirmBatch.job_count !== 1 ? "s" : ""} via Stripe. This moves real money and can't be undone here.`
            : ""
        }
        primaryLabel={confirmBatch && paying === confirmBatch.helper_id ? "Sending…" : "Send Payout"}
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
    </AdminViewShell>
  );
};

export default AdminPayoutBatches;
