/**
 * Admin > Shops Orders (Shops M4, migration 20261019043209_shops_refunds_cancels_strikes;
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
 *   Payout hold       the existing admin_set_payout_hold / admin_release_payout_hold
 *                     (usePayoutHolds, which also freezes Stripe's automatic payouts)
 *
 * Test rows (an order with a test account on either side) wear <TestTag />.
 */
import { useId, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { BrandConfirmDialog } from "@/components/ui/BrandConfirmDialog";
import { ErrorState } from "@/components/ui/ErrorState";
import { Skeleton } from "@/components/ui/skeleton";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { AdminCard, AdminViewShell } from "./AdminViewShell";
import { TestTag } from "./TestTag";
import { rpcErrorMessage } from "./adminRpcErrorCopy";
import { usePayoutHolds } from "./adminPayoutBatches/usePayoutHolds";
import { adminRefundOrder, formatCents, type AdminRefundReason } from "@/lib/shops/orders";
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
  attempts: number; last_error: string | null; on_hold: boolean; hold_reason: string | null; is_seed: boolean;
}
interface StrikeRow {
  strike_id: string; user_id: string; offender_side: "buyer" | "shop"; reason: string; order_id: string | null;
  given_at: string; expires_at: string; active_count: number; is_seed: boolean;
}
interface Queue { problems: Problem[]; refunds: RefundRow[]; payouts: PayoutRow[]; strikes: StrikeRow[] }

export const REFUND_REASONS: { value: AdminRefundReason; label: string; detail: string }[] = [
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
function adminFail(error: { message: string }, userMessage: string | null): never {
  throw Object.assign(new Error(error.message), error, { userMessage: userMessage ?? undefined });
}

async function fetchQueue(): Promise<Queue> {
  const { data, error } = await supabase.rpc("shops_admin_queue");
  if (error) adminFail(error, rpcErrorMessage("shops_admin_queue", error));
  const q = (data ?? {}) as Partial<Queue>;
  return { problems: q.problems ?? [], refunds: q.refunds ?? [], payouts: q.payouts ?? [], strikes: q.strikes ?? [] };
}

async function runAction(a: Action, note: string, reason: AdminRefundReason | null): Promise<void> {
  if (a.kind === "pay") {
    const { error } = await supabase.rpc("shops_admin_pay_shop", { p_order_id: a.orderId, p_note: note });
    if (error) adminFail(error, rpcErrorMessage("shops_admin_pay_shop", error));
  } else if (a.kind === "refund") {
    if (!reason) throw new Error("invalid_reason");
    await adminRefundOrder(a.orderId, reason, note);
  } else if (a.kind === "remove_strike") {
    const { error } = await supabase.rpc("shops_admin_remove_strike", { p_strike_id: a.strikeId, p_note: note });
    if (error) adminFail(error, rpcErrorMessage("shops_admin_remove_strike", error));
  } else if (a.kind === "give_strike") {
    const { error } = await supabase.rpc("shops_admin_give_strike", { p_order_id: a.orderId, p_side: a.side, p_note: note });
    if (error) adminFail(error, rpcErrorMessage("shops_admin_give_strike", error));
  }
}

const TITLES: Record<Action["kind"], string> = {
  pay: "Pay the shop?",
  refund: "Refund this order?",
  remove_strike: "Remove this strike?",
  give_strike: "Give a Shops strike?",
  hold: "Hold this shop's payouts?",
};

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
      <AdminCard title="Problems" subtitle="A buyer says they didn't get a paid order. The shop's payout waits for you.">
        {q.problems.length === 0 ? <p className="text-sm text-muted-foreground">No open problems.</p> : (
          <ul className="space-y-3">
            {q.problems.map((p) => (
              <li key={p.order_id} className="space-y-1 rounded-xl border border-border p-3" data-testid="admin-shops-problem">
                <p className="text-sm font-semibold">{p.shop_name ?? "A shop"} · {formatCents(p.total_cents)} · ready {p.ready_date}{p.is_seed && <TestTag />}</p>
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
                {formatCents(r.refund_cents)} · {r.reason} · {r.status} ({r.attempts} tries) · order {short(r.order_id)}{r.is_seed && <TestTag />}
                {r.last_error && <span className="block text-xs text-muted-foreground [overflow-wrap:anywhere]">{r.last_error}</span>}
              </li>
            ))}
          </ul>
        )}
      </AdminCard>

      <AdminCard title="Shop payouts waiting" subtitle="Pending, failed, or on hold.">
        {q.payouts.length === 0 ? <p className="text-sm text-muted-foreground">No payouts waiting.</p> : (
          <ul className="space-y-2">
            {q.payouts.map((p) => (
              <li key={p.payout_id} className="flex flex-wrap items-center gap-2 text-sm" data-testid="admin-shops-payout">
                <span>{p.shop_name ?? "A shop"} · {formatCents(p.amount_cents)} · {p.status} ({p.attempts} tries){p.on_hold ? ` · ON HOLD: ${p.hold_reason ?? ""}` : ""}</span>
                {p.is_seed && <TestTag />}
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

      <AdminCard title="Active Shops strikes" subtitle="Shops has its own count; 3 active strikes pause Shops for that member. Each ends after a year.">
        {q.strikes.length === 0 ? <p className="text-sm text-muted-foreground">No active strikes.</p> : (
          <ul className="space-y-2">
            {q.strikes.map((s) => (
              <li key={s.strike_id} className="flex flex-wrap items-center gap-2 text-sm" data-testid="admin-shops-strike">
                <span>{s.offender_side} {short(s.user_id)} · {s.reason} · {s.active_count} of 3 · ends {new Date(s.expires_at).toLocaleDateString()}</span>
                {s.is_seed && <TestTag />}
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
              <label key={r.value} className="flex items-start gap-2 text-sm">
                <input type="radio" name="shop-refund-reason" value={r.value} checked={reason === r.value} onChange={() => setReason(r.value)} />
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
