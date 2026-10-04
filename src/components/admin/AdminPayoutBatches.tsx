import { useMemo, useState } from "react";
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
import { BatchRow } from "./adminPayoutBatches/BatchRow";
import { LedgerList } from "./adminPayoutBatches/LedgerList";
import { NESTED_EMPTY_SURFACE } from "@/components/admin/adminEmptyState";
import { requireBiometric } from "@/lib/biometricGate";
import { fetchSeedUserIds } from "@/components/admin/seedRows";
import { userFacingError } from "@/lib/userFacingError";
import { rpcErrorMessage } from "@/lib/lifecycleErrors";
import { releaseBatchJobs } from "./adminPayoutBatches/releaseBatchJobs";

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
  const [holdReasonDraft, setHoldReasonDraft] = useState<{ helperId: string; reason: string } | null>(null);
  // Deny flow: required reason, seeded with the default the old
  // window.prompt offered so a one-tap deny still records a sensible note.
  const [denyDraft, setDenyDraft] = useState<{ helperId: string; reason: string } | null>(null);

  // ── Payout holds live on the SERVER (Q764) ──────────────────────────────
  // public.payout_holds: every admin reads the same rows (RLS: admins only),
  // and every payout path refuses a held Helpr (release-payout, the scheduled
  // crons, cash-outs, tips). They used to live in this browser's localStorage,
  // so a second admin's Send Payout or Bulk Approve, and the crons, paid a
  // "held" Helpr. Writes go through admin-only RPCs, which also write the
  // admin_audit_log row themselves (so nothing here calls logAdminAction).
  const holdsKey = ["admin-payout-holds", adminId] as const;
  const {
    data: holdRows,
    isLoading: holdsLoading,
    isError: holdsError,
    refetch: refetchHolds,
  } = useQuery({
    queryKey: holdsKey,
    enabled: !!adminId,
    // Admin-only safety state: opt out of disk persistence like the queue.
    meta: { persist: false },
    queryFn: async () =>
      unwrap(
        await supabase
          .from("payout_holds")
          .select("helper_id, reason, held_at, held_by, denied_at, denied_reason"),
      ),
  });
  const holds = useMemo(() => {
    const out: Record<string, { reason: string; addedAt: string; addedBy?: string }> = {};
    for (const h of holdRows ?? []) {
      out[h.helper_id] = {
        reason: h.denied_reason ? `[DENIED] ${h.denied_reason}` : h.reason,
        addedAt: h.held_at,
        addedBy: h.held_by ?? undefined,
      };
    }
    return out;
  }, [holdRows]);

  /** One hold write: throws into a toast, and re-reads the holds on success. */
  const runHoldWrite = async (
    label: string,
    write: () => Promise<boolean>,
    copyFor: (err: unknown) => string | null,
  ): Promise<boolean> => {
    try {
      if (!(await write())) throw new Error(`${label}: the server did not confirm the change`);
      await qc.invalidateQueries({ queryKey: holdsKey });
      return true;
    } catch (err: unknown) {
      report(err, { tags: { source: `AdminPayoutBatches.${label}` } });
      toast.error(copyFor(err) ?? userFacingError(err, "Couldn't update that payout hold — try again."));
      return false;
    }
  };

  const addHold = async (helperId: string, reason: string) => {
    const ok = await runHoldWrite("addHold", async () => {
      const row = unwrap(await supabase.rpc("admin_set_payout_hold", { p_helper_id: helperId, p_reason: reason }));
      return !!row && row.helper_id === helperId;
    }, (err) => rpcErrorMessage("admin_set_payout_hold", err));
    if (!ok) return;
    setSelected((prev) => {
      const n = new Set(prev);
      n.delete(helperId);
      return n;
    });
  };
  const releaseHold = async (helperId: string) => {
    // The RPC answers false when there was no hold to clear (another admin
    // released it first). The end state is the one asked for, so that is not
    // an error; a thrown error is.
    await runHoldWrite("releaseHold", async () => {
      unwrap(await supabase.rpc("admin_release_payout_hold", { p_helper_id: helperId }));
      return true;
    }, (err) => rpcErrorMessage("admin_release_payout_hold", err));
  };
  const denyHold = async (helperId: string, reason: string) => {
    // A denial is recorded ON the hold and keeps blocking every payout path.
    // Nothing is refunded or reversed here.
    await runHoldWrite("denyHold", async () => {
      const row = unwrap(await supabase.rpc("admin_deny_payout_hold", { p_helper_id: helperId, p_reason: reason }));
      return !!row && row.helper_id === helperId;
    }, (err) => rpcErrorMessage("admin_deny_payout_hold", err));
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
      const seed = await fetchSeedUserIds((data ?? []).map((r) => r.helper_id));
      return (data ?? []).map((r) => ({
        ...r,
        helper_name: formatName(r.helper_name, "Unknown"),
        is_seed: seed.has(r.helper_id),
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
      // `helper_id` is NULLABLE: payout_transfers_helper_id_fkey is
      // ON DELETE SET NULL against auth.users, so a helper who deletes their
      // account leaves their settled transfers behind with a null helper.
      //
      // A null must never reach `.in()`. PostgREST serialises the list into
      // the URL as `in.(<uuid>,null)`, Postgres rejects `null` as a uuid
      // literal, and the response is HTTP 400 `22P02 invalid input syntax for
      // type uuid: "null"` — for the WHOLE request, not one row. Wrapped in
      // `unwrap()` that throws, so a single departed helper would put the
      // entire payout ledger into an error state rather than blanking one
      // name. Verified against prod: `in.(<uuid>,null)` → 400, the same query
      // without the null → 200.
      //
      // The row itself still renders; `nameMap.get(null)` misses and
      // LedgerList falls back to its "Unknown Helpr" label.
      const helperIds = [...new Set(rows.map((r) => r.helper_id).filter((id): id is string => !!id))];
      const profileRows = helperIds.length
        ? unwrap(
            await supabase
              .from("profiles")
              .select("user_id, full_name, is_seed")
              .in("user_id", helperIds),
          )
        : [];
      const nameMap = new Map((profileRows ?? []).map((p) => [p.user_id, p]));
      return rows.map((r) => ({
        ...r,
        profiles: { full_name: nameMap.get(r.helper_id)?.full_name ?? null, is_seed: nameMap.get(r.helper_id)?.is_seed ?? null },
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
      const { jobIds, failures } = await releaseBatchJobs(batch.helper_id);

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
      toast.error(userFacingError(err, "Couldn't trigger that payout — try again."));
    } finally {
      setPaying(null);
    }
  };

  // Until the holds are known, NOTHING is ready: a batch must never be
  // offered for (bulk) payout on the strength of a hold list not yet read.
  const holdsKnown = !!holdRows;
  const readyBatches = holdsKnown ? batches.filter((b) => !holds[b.helper_id]) : [];
  const heldBatches = holdsKnown ? batches.filter((b) => holds[b.helper_id]) : [];
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
        // Same path as the per-batch button (Q758): job ids, then
        // release-payout per job. `stripe-payouts` only reads a balance.
        const { jobIds, failures } = await releaseBatchJobs(batch.helper_id);
        const paid = jobIds.length - failures.length;
        // Log what ACTUALLY moved, not what was attempted.
        if (paid > 0) {
          await logAdminAction("trigger_payout", "user", batch.helper_id, {
            jobs_attempted: jobIds.length,
            jobs_paid: paid,
            jobs_failed: failures.length,
            total_payout: batch.total_payout,
            bulk: true,
          });
        }
        if (failures.length > 0) {
          throw new Error(
            `Paid ${paid} of ${jobIds.length} for ${batch.helper_name}. ${failures.length} could not be released — ` +
              `they stay in the batch, and retrying is safe.`,
          );
        }
      } catch (err: unknown) {
        report(err, { tags: { source: "AdminPayoutBatches.triggerBulkPayout" } });
        toast.error(userFacingError(err, `Couldn't process the payout for ${batch.helper_name} — try again?`));
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
          queue so they don't sneak into a bulk select. Holds are server-side
          (public.payout_holds, Q764): every admin sees the same held list, and
          the payout functions refuse a held Helpr even if a stale screen
          offers Pay Out. */}
      {/* `overflow-x-auto` + nowrap tabs: a longer tab label once wrapped to
          three lines at 375 and read as a broken control. */}
      {batches.length > 0 && (
        <div role="tablist" aria-label="Payout queue" className="flex gap-1.5 border-b border-border overflow-x-auto no-scrollbar">
          <button
            type="button"
            role="tab"
            aria-selected={tab === "ready"}
            onClick={() => { setTab("ready"); clearSelection(); }}
            className={`shrink-0 whitespace-nowrap pb-2 px-3 -mb-px text-ds-13 font-medium border-b-2 transition-colors ${
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
            className={`shrink-0 whitespace-nowrap pb-2 px-3 -mb-px text-ds-13 font-medium border-b-2 transition-colors ${
              tab === "hold" ? "border-primary text-foreground" : "border-transparent text-muted-foreground hover:text-foreground"
            }`}
          >
            <span className="inline-flex items-center gap-1.5">
              <Pause className="w-3.5 h-3.5" /> Hold for Review
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

      {isInitialLoading || holdsLoading ? (
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
      ) : isError || holdsError ? (
        <ErrorState
          surfaceStyle={NESTED_EMPTY_SURFACE}
          variant="inline"
          title={isError ? "We couldn't load payout batches." : "We couldn't load payout holds."}
          body="Tap Try again. No transfers were fired — the queue is server-side."
          onRetry={() => {
            if (isError) void refetch();
            if (holdsError) void refetchHolds();
          }}
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
          data-rail-inset
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
                Stops every payout to this Helpr until an admin releases the
                hold: Send Payout, Bulk Approve, scheduled payouts, cash-outs
                and tips. Every admin sees it. Logged to admin_audit_log.
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
                void addHold(holdReasonDraft.helperId, holdReasonDraft.reason.trim() || "No reason given");
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
