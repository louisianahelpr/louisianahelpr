/**
 * Admin > Shops Orders (Shops M4, migration 20261019071055_shops_refunds_cancels_strikes;
 * spec L43, L75; docs/OPEN.md Q1952 / Q2156).
 *
 * One read, shops_admin_queue (admin only): open "I didn't get it" problems
 * (the shop's payout waits for this screen), refunds Stripe has not finished,
 * shop payouts pending / failed / on hold, and active Shops strikes.
 *
 *   Pay the shop      shops_admin_pay_shop (the buyer did get it; a note is required)
 *   Refund by reason  shop-checkout admin_refund (the SQL decides who carries the
 *                     card fee: shop fault = the shop, no fault = the buyer keeps
 *                     paying the card cost, our mistake = Louisiana Helpr, shop
 *                     removed = the shop); a note is required
 *   Strikes           shops_admin_remove_strike / shops_admin_give_strike (note required)
 *   Record a refund made in Stripe
 *                     shop-checkout admin_record_hand_refund (/code-review of shops-m3-v1 #1,
 *                     v2 rule B: the edge reads the refund from Stripe and checks it is
 *                     on this order's payment for this amount, then records it):
 *                     a refund made by hand in the Stripe Dashboard, recorded by its
 *                     re_ id and amount. No new Stripe refund is made; the order
 *                     closes as refunded / partly refunded and the shop's payout is
 *                     held. The webhook records most of these on its own; the ops
 *                     alert points here when it could not.
 * A brand-new RPC the database has not deployed yet (PGRST202) shows as "not on the
 * server yet", never as an empty queue or a raw error (/code-review of shops-m3-v1 #8).
 *   Payout hold       the existing admin_set_payout_hold / admin_release_payout_hold
 *                     (usePayoutHolds, which also freezes Stripe's automatic payouts)
 *
 * Test rows (an order with a test account on either side) are left out (owner 2026-10-27).
 */
import { useId, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { BrandConfirmDialog } from "@/components/ui/BrandConfirmDialog";
import { ErrorState } from "@/components/ui/ErrorState";
import { Skeleton } from "@/components/ui/skeleton";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { AdminCard, AdminViewShell } from "./AdminViewShell";
import { withoutTestRows } from "./seedRows";
import { isMissingRpcNamed } from "@/lib/missingRpc";
import { rpcErrorMessage } from "./adminRpcErrorCopy";
import { usePayoutHolds } from "./adminPayoutBatches/usePayoutHolds";
import { adminRecordHandRefund, adminRefundOrder, formatCents, type AdminRefundReason } from "@/lib/shops/orders";
import { shopsErrorMessage } from "@/lib/shops/errors";

interface Problem {
  order_id: string; seller_id: string | null; shop_name: string | null; ready_date: string; total_cents: number;
  card_fee_cents: number | null; handover_mode: string; problem_at: string; problem_note: string; ready_at: string | null; is_seed: boolean;
}
interface RefundRow {
  refund_id: string; order_id: string; reason: string; refund_cents: number; status: string; attempts: number;
  last_error: string | null; created_at: string; is_seed: boolean;
}
interface PayoutRow {
  payout_id: string; order_id: string; seller_id: string | null; shop_name: string | null; amount_cents: number; status: string;
  attempts: number; last_error: string | null; review_reason?: string | null; on_hold: boolean; hold_reason: string | null; is_seed: boolean;
}
interface StrikeRow {
  strike_id: string; user_id: string; offender_side: "buyer" | "shop"; reason: string; order_id: string | null;
  given_at: string; expires_at: string; active_count: number; is_seed: boolean;
}
interface Queue { problems: Problem[]; refunds: RefundRow[]; payouts: PayoutRow[]; strikes: StrikeRow[]; notDeployed?: boolean }

const NOT_DEPLOYED = "This isn't on the server yet (it is still deploying). Try again in a few minutes.";

const REFUND_REASONS: { value: AdminRefundReason; label: string; detail: string }[] = [
  { value: "problem_shop_fault", label: "The shop's fault", detail: "Full refund. The shop pays the card fee and gets a Shops strike." },
  { value: "problem_no_fault", label: "Nobody's fault", detail: "The price back; the card-processing cost and its tax are kept." },
  { value: "problem_our_mistake", label: "Our mistake", detail: "Full refund. Louisiana Helpr carries the card fee." },
  { value: "shop_removed", label: "Shop removed", detail: "Full refund. The shop pays the card fee." },
];

type Action =
  | { kind: "pay"; orderId: string }
  | { kind: "refund"; orderId: string }
  | { kind: "remove_strike"; strikeId: string }
  | { kind: "give_strike"; orderId: string; side: "buyer" | "shop" }
  | { kind: "hold"; sellerId: string };

/** An admin RPC's refusal, carrying its words (read at each call site with rpcErrorMessage). */
function adminFail(error: { message: string }, notDeployed: boolean, userMessage: string | null): never {
  throw Object.assign(new Error(error.message), error, { userMessage: (notDeployed ? NOT_DEPLOYED : userMessage) ?? undefined });
}

async function fetchQueue(): Promise<Queue> {
  const { data, error } = await supabase.rpc("shops_admin_queue");
  if (error && isMissingRpcNamed(error, "shops_admin_queue")) return { problems: [], refunds: [], payouts: [], strikes: [], notDeployed: true };
  if (error) adminFail(error, false, rpcErrorMessage("shops_admin_queue", error));
  const q = (data ?? {}) as Partial<Queue>;
  // Owner 2026-10-27: admin never shows a test (is_seed) row.
  return {
    problems: withoutTestRows(q.problems ?? []),
    refunds: withoutTestRows(q.refunds ?? []),
    payouts: withoutTestRows(q.payouts ?? []),
    strikes: withoutTestRows(q.strikes ?? []),
  };
}

async function runAction(a: Action, note: string, reason: AdminRefundReason | null): Promise<void> {
  if (a.kind === "pay") {
    const { error } = await supabase.rpc("shops_admin_pay_shop", { p_order_id: a.orderId, p_note: note });
    if (error) adminFail(error, isMissingRpcNamed(error, "shops_admin_pay_shop"), rpcErrorMessage("shops_admin_pay_shop", error));
  } else if (a.kind === "refund") {
    if (!reason) throw new Error("invalid_reason");
    await adminRefundOrder(a.orderId, reason, note);
  } else if (a.kind === "remove_strike") {
    const { error } = await supabase.rpc("shops_admin_remove_strike", { p_strike_id: a.strikeId, p_note: note });
    if (error) adminFail(error, isMissingRpcNamed(error, "shops_admin_remove_strike"), rpcErrorMessage("shops_admin_remove_strike", error));
  } else if (a.kind === "give_strike") {
    const { error } = await supabase.rpc("shops_admin_give_strike", { p_order_id: a.orderId, p_side: a.side, p_note: note });
    if (error) adminFail(error, isMissingRpcNamed(error, "shops_admin_give_strike"), rpcErrorMessage("shops_admin_give_strike", error));
  }
}

const TITLES: Record<Action["kind"], string> = {
  pay: "Pay the shop?",
  refund: "Refund this order?",
  remove_strike: "Remove this strike?",
  give_strike: "Give a Shops strike?",
  hold: "Hold this shop's payouts?",
};

/** "12.34" or "$12.34" -> 1234 cents; anything else -> null. */
function parseDollarsToCents(text: string): number | null {
  const m = /^\$?\s*(\d{1,6})(?:\.(\d{1,2}))?$/.exec(text.trim());
  if (!m) return null;
  const cents = Number(m[1]) * 100 + Number((m[2] ?? "0").padEnd(2, "0"));
  return cents > 0 ? cents : null;
}



const HAND_OUTCOME: Record<string, string> = {
  closed_refunded: "Recorded. The order is closed as refunded and the shop is not paid for it.",
  closed_partially_refunded: "Recorded. The order is closed as partly refunded; any shop payout is held for review.",
  recorded_refund_held: "Recorded. The order's own refund is held (never sent on top): settle or release it in Payouts held for review.",
  recorded_other_order: "That refund is already recorded on a different order. Nothing changed.",
  recorded_not_charged: "Recorded. The order was never recorded as charged, so it is held: check it.",
  recorded_row_already_settled: "Recorded. The app's own refund had already gone out: the buyer may have been refunded twice.",
  recorded_after_payout: "Recorded. The shop had already been paid: recover it from the shop by hand.",
  already: "This refund was already recorded.",
};

function RecordHandRefund({ onDone }: { onDone: () => void }) {
  const ids = useId();
  const [orderId, setOrderId] = useState("");
  const [refundId, setRefundId] = useState("");
  const [amount, setAmount] = useState("");
  const [note, setNote] = useState("");
  const cents = parseDollarsToCents(amount);
  const save = useMutation({
    mutationFn: () => adminRecordHandRefund(orderId.trim(), refundId.trim(), cents ?? 0, note.trim()),
    onSuccess: (outcome) => {
      toast.success(HAND_OUTCOME[outcome] ?? "Recorded.");
      setOrderId(""); setRefundId(""); setAmount(""); setNote("");
      onDone();
    },
    onError: (err) => toast.error(shopsErrorMessage(err)),
  });
  const ready = /^[0-9a-f-]{36}$/i.test(orderId.trim()) && /^(re|pyr)_[A-Za-z0-9]+$/.test(refundId.trim()) && cents !== null
    && note.trim().length > 0 && note.length <= 500;
  return (
    <form
      className="grid gap-3 sm:grid-cols-2"
      data-testid="admin-shops-hand-refund"
      onSubmit={(e) => { e.preventDefault(); if (ready && !save.isPending) save.mutate(); }}
    >
      <div className="space-y-1">
        <Label htmlFor={`${ids}-order`}>Order id</Label>
        <Input id={`${ids}-order`} value={orderId} onChange={(e) => setOrderId(e.target.value)} autoComplete="off" />
      </div>
      <div className="space-y-1">
        <Label htmlFor={`${ids}-refund`}>Stripe refund id (re_…)</Label>
        <Input id={`${ids}-refund`} value={refundId} onChange={(e) => setRefundId(e.target.value)} autoComplete="off" />
      </div>
      <div className="space-y-1">
        <Label htmlFor={`${ids}-amount`}>Amount refunded ($)</Label>
        <Input id={`${ids}-amount`} value={amount} inputMode="decimal" onChange={(e) => setAmount(e.target.value)} autoComplete="off" />
      </div>
      <div className="space-y-1 sm:col-span-2">
        <Label htmlFor={`${ids}-note`}>Note (required)</Label>
        <Textarea id={`${ids}-note`} value={note} maxLength={500} onChange={(e) => setNote(e.target.value)} />
      </div>
      <div className="sm:col-span-2">
        <Button type="submit" size="sm" disabled={!ready || save.isPending}>{save.isPending ? "Saving…" : "Record the refund"}</Button>
      </div>
    </form>
  );
}

const short = (id: string | null) => (id ? id.slice(0, 8) : "gone");
const when = (iso: string) => new Date(iso).toLocaleString();

export default function AdminShopsOrders() {
  const qc = useQueryClient();
  const noteId = useId();
  const { user } = useCurrentUser();
  const holds = usePayoutHolds(user?.id);
  const [action, setAction] = useState<Action | null>(null);
  const [note, setNote] = useState("");
  const [reason, setReason] = useState<AdminRefundReason | null>(null);
  const queue = useQuery({ queryKey: ["admin-shops-queue"], queryFn: fetchQueue, meta: { persist: false } });
  const open = (a: Action) => { setNote(""); setReason(null); setAction(a); };
  const act = useMutation({
    mutationFn: async () => {
      if (!action) return;
      if (action.kind === "hold") {
        if (!(await holds.addHold(action.sellerId, note.trim()))) throw Object.assign(new Error("hold_failed"), { toasted: true });
        return;
      }
      await runAction(action, note.trim(), reason);
    },
    onSuccess: () => { toast.success("Done."); setAction(null); },
    onError: (err) => {
      // usePayoutHolds already said why a hold failed.
      if (!(err as { toasted?: boolean }).toasted) toast.error(shopsErrorMessage(err));
    },
    onSettled: () => { void qc.invalidateQueries({ queryKey: ["admin-shops-queue"] }); },
  });

  if (queue.isError) {
    return <ErrorState variant="inline" title="We couldn't load the Shops queue." body={shopsErrorMessage(queue.error)} onRetry={() => void queue.refetch()} />;
  }
  if (queue.isLoading || !queue.data) {
    return (
      <AdminViewShell>
        <div role="status" aria-label="Loading the Shops queue" className="space-y-3">
          {[0, 1, 2].map((i) => <Skeleton key={i} className="h-24 w-full rounded-2xl" />)}
        </div>
      </AdminViewShell>
    );
  }
  const q = queue.data;
  const needsReason = action?.kind === "refund";
  return (
    <AdminViewShell>
      {q.notDeployed && (
        <p role="status" className="rounded-xl border border-border p-3 text-sm" data-testid="admin-shops-not-deployed">
          The Shops queue isn't on the server yet (it is still deploying). Check again in a few minutes.
        </p>
      )}
      <AdminCard title="Problems" subtitle="A buyer says they didn't get a paid order. The shop's payout waits for you.">
        {q.problems.length === 0 ? <p className="text-sm text-muted-foreground">No open problems.</p> : (
          <ul className="space-y-3">
            {q.problems.map((p) => (
              <li key={p.order_id} className="space-y-1 rounded-xl border border-border p-3" data-testid="admin-shops-problem">
                <p className="text-sm font-semibold">{p.shop_name ?? "A shop"} · {formatCents(p.total_cents)} · ready {p.ready_date}</p>
                <p className="text-sm [overflow-wrap:anywhere]">"{p.problem_note}"</p>
                <p className="text-xs text-muted-foreground">
                  Reported {when(p.problem_at)}. {p.handover_mode === "porch" ? "Left out" : "In person"}; {p.ready_at ? "the shop marked it ready" : "never marked ready"}.
                </p>
                <div className="flex flex-wrap gap-2">
                  <Button type="button" size="sm" variant="outline" onClick={() => open({ kind: "pay", orderId: p.order_id })}>Pay the shop</Button>
                  <Button type="button" size="sm" variant="outline" onClick={() => open({ kind: "refund", orderId: p.order_id })}>Refund…</Button>
                  <Button type="button" size="sm" variant="outline" onClick={() => open({ kind: "give_strike", orderId: p.order_id, side: "shop" })}>Strike the shop</Button>
                  <Button type="button" size="sm" variant="outline" onClick={() => open({ kind: "give_strike", orderId: p.order_id, side: "buyer" })}>Strike the buyer</Button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </AdminCard>

      <AdminCard title="Refunds not finished" subtitle="Written in the database; Stripe has not confirmed them yet. The money job retries every 10 minutes.">
        {q.refunds.length === 0 ? <p className="text-sm text-muted-foreground">Every refund went through.</p> : (
          <ul className="space-y-2">
            {q.refunds.map((r) => (
              <li key={r.refund_id} className="text-sm" data-testid="admin-shops-refund">
                {formatCents(r.refund_cents)} · {r.reason} · {r.status} ({r.attempts} tries) · order {short(r.order_id)}
                {r.last_error && <span className="block text-xs text-muted-foreground [overflow-wrap:anywhere]">{r.last_error}</span>}
              </li>
            ))}
          </ul>
        )}
      </AdminCard>

      <AdminCard title="Shop payouts waiting" subtitle="Pending, failed, on hold, or held for review.">
        {q.payouts.length === 0 ? <p className="text-sm text-muted-foreground">No payouts waiting.</p> : (
          <ul className="space-y-2">
            {q.payouts.map((p) => (
              <li key={p.payout_id} className="flex flex-wrap items-center gap-2 text-sm" data-testid="admin-shops-payout">
                <span>{p.shop_name ?? "A shop"} · {formatCents(p.amount_cents)} · {p.status} ({p.attempts} tries){p.on_hold ? ` · ON HOLD: ${p.hold_reason ?? ""}` : ""}</span>
                {p.status === "held_for_review" && p.review_reason && (
                  <span className="block w-full text-xs text-muted-foreground [overflow-wrap:anywhere]">Held for review: {p.review_reason}. Decide it in Payouts held for review.</span>
                )}
                
                {p.seller_id && (p.on_hold ? (
                  <Button type="button" size="sm" variant="outline" onClick={() => void holds.releaseHold(p.seller_id!).then(() => qc.invalidateQueries({ queryKey: ["admin-shops-queue"] }))}>Release hold</Button>
                ) : (
                  <Button type="button" size="sm" variant="outline" onClick={() => open({ kind: "hold", sellerId: p.seller_id! })}>Hold payouts</Button>
                ))}
              </li>
            ))}
          </ul>
        )}
      </AdminCard>

      <AdminCard
        title="Record a refund made in Stripe"
        subtitle="Refunded a Shops order by hand in the Stripe Dashboard? Record it here. No new refund is made; the order closes and the shop is not paid for it."
      >
        <RecordHandRefund onDone={() => { void qc.invalidateQueries({ queryKey: ["admin-shops-queue"] }); }} />
      </AdminCard>

      <AdminCard title="Active Shops strikes" subtitle="Shops has its own count; 3 active strikes pause Shops for that member. Each ends after a year.">
        {q.strikes.length === 0 ? <p className="text-sm text-muted-foreground">No active strikes.</p> : (
          <ul className="space-y-2">
            {q.strikes.map((s) => (
              <li key={s.strike_id} className="flex flex-wrap items-center gap-2 text-sm" data-testid="admin-shops-strike">
                <span>{s.offender_side} {short(s.user_id)} · {s.reason} · {s.active_count} of 3 · ends {new Date(s.expires_at).toLocaleDateString()}</span>
                
                <Button type="button" size="sm" variant="outline" onClick={() => open({ kind: "remove_strike", strikeId: s.strike_id })}>Remove</Button>
              </li>
            ))}
          </ul>
        )}
      </AdminCard>

      <BrandConfirmDialog
        open={!!action}
        onOpenChange={(o) => { if (!o) setAction(null); }}
        title={action ? TITLES[action.kind] : ""}
        description={action?.kind === "pay" ? "The order finishes and the shop is paid (minus any card-fee debt)." : "Other admins see your note in the audit log."}
        primaryLabel={act.isPending ? "Saving…" : "Confirm"}
        primaryDisabled={act.isPending || !note.trim() || note.length > 500 || (needsReason && !reason)}
        onPrimary={(e) => { e.preventDefault(); act.mutate(); }}
        secondaryLabel="Cancel"
      >
        {needsReason && (
          <fieldset className="space-y-2">
            <legend className="text-sm font-semibold">Whose fault?</legend>
            {REFUND_REASONS.map((r) => (
              <label key={r.value} className="flex min-h-11 items-start gap-2 text-sm">
                <input type="radio" className="mt-0.5 h-4 w-4 min-h-0 min-w-0 shrink-0" style={{ accentColor: "hsl(var(--primary))" }} name="shop-refund-reason" value={r.value} checked={reason === r.value} onChange={() => setReason(r.value)} />
                <span><span className="font-semibold">{r.label}.</span> {r.detail}</span>
              </label>
            ))}
          </fieldset>
        )}
        <div className="space-y-1">
          <Label htmlFor={noteId}>Note (required)</Label>
          <Textarea id={noteId} value={note} maxLength={500} onChange={(e) => setNote(e.target.value)} />
        </div>
      </BrandConfirmDialog>
    </AdminViewShell>
  );
}
