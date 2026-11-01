/**
 * Payouts and refunds HELD FOR REVIEW (20261019070737): rows declutter-money took out of every
 * queue because they will not pay themselves (rejected or unusable payout account, payee
 * deleted, mixed test and real parties, a banned payee, a data defect, or a transfer that may
 * already exist). Two actions, both synchronous and audited in SQL:
 *   "Release to automatic"  back to the queue; ALWAYS with the confirmation that Stripe shows no
 *                           transfer / refund made for this row outside the app.
 *   "Mark settled by hand"  terminal at once, with the Stripe id (tr_ / po_ for a payout, re_
 *                           for a refund) or "other: how it was paid", the amount and a note.
 *                           The SQL refuses an id already recorded on any money row in the app.
 * Each row shows the payee, their payout account, the amount, the Stripe group / payment, and
 * the ids OTHER rows of the same payee already recorded, so a sibling's transfer is not reused.
 * A Shops refund (20261019071055, held because a refund was made in Stripe on its order) is
 * settled only for its WHOLE amount (the amount is fixed here; the SQL refuses any other), and
 * the SQL refuses to release a Shops row while that Stripe refund stands.
 */
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { unwrap } from "@/lib/supabaseResult";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { AdminCard } from "@/components/admin/AdminViewShell";
import { formatPriceExact } from "@/lib/format";
import { rpcErrorMessage } from "@/components/admin/adminRpcErrorCopy";
import { adminSettleHeldShopRefund } from "@/lib/shops/orders";
import { shopsErrorMessage } from "@/lib/shops/errors";
import { heldReasonWords } from "./heldReason";

export type HeldRow = {
  kind: "declutter" | "helpr_task" | "shop" | "declutter_refund" | "delivery_refund" | "shop_refund" | "declutter_manager";
  id: string;
  payee_id: string | null;
  payee_account?: string | null;
  amount_cents: number;
  reason: string | null;
  held_at: string | null;
  stripe_group: string | null;
  sibling_refs?: Array<{ kind: string; id: string; ref: string; amount_cents: number }> | null;
};

const KIND_LABEL: Record<HeldRow["kind"], string> = {
  declutter: "Declutter seller payout",
  helpr_task: "Delivery Helpr payout",
  shop: "Shop payout",
  declutter_refund: "Declutter refund",
  delivery_refund: "Delivery-fee refund",
  shop_refund: "Shops refund",
  // Manager mode (20261101234732): the manager's share of a Declutter sale, paid to the manager.
  declutter_manager: "Declutter manager share",
};

/** Settled only for the whole amount the row owes (the SQL CHECKs it too). */
const WHOLE_AMOUNT_ONLY: ReadonlySet<HeldRow["kind"]> = new Set(["shop_refund"]);

async function fetchHeld(): Promise<HeldRow[]> {
  const { data, error } = await supabase.rpc("admin_payouts_held_for_review");
  if (error) throw Object.assign(new Error(error.message), { userMessage: rpcErrorMessage("admin_payouts_held_for_review", error) ?? undefined });
  // Only rows this card knows how to act on.
  return ((Array.isArray(data) ? data : []) as unknown as HeldRow[]).filter((r) => r && r.kind in KIND_LABEL && typeof r.id === "string");
}

/** Payee names for the held rows (AUD31-43: a bare user id told the admin nothing). A failed read shows the ids alone. */
async function fetchPayeeNames(ids: string[]): Promise<Record<string, string>> {
  if (ids.length === 0) return {};
  // unwrap keeps the HTTP status the retry policy reads (src/lib/queryRetry.ts).
  const data = unwrap(await supabase.from("profiles").select("user_id, full_name").in("user_id", ids));
  const out: Record<string, string> = {};
  for (const p of (data ?? []) as Array<{ user_id: string; full_name: string | null }>) {
    if (p.full_name?.trim()) out[p.user_id] = p.full_name.trim();
  }
  return out;
}

const money = (cents: number) => `$${formatPriceExact(cents / 100)}`;

type Draft = { row: HeldRow; action: "release" | "settle"; note: string; ref: string; amount: string; confirmed: boolean };

/** "12.34" -> 1234; anything else -> null. */
function toCents(v: string): number | null {
  const m = /^\s*(\d+)(?:\.(\d{1,2}))?\s*$/.exec(v);
  if (!m) return null;
  return Number(m[1]) * 100 + Number((m[2] ?? "").padEnd(2, "0"));
}

export function HeldForReview() {
  const qc = useQueryClient();
  const { data: rows, isLoading, error } = useQuery({ queryKey: ["admin", "payouts-held-for-review"], queryFn: fetchHeld });
  const payeeIds = Array.from(new Set((rows ?? []).map((r) => r.payee_id).filter((v): v is string => !!v))).sort();
  const { data: names } = useQuery({
    queryKey: ["admin", "payouts-held-for-review", "payee-names", payeeIds],
    queryFn: () => fetchPayeeNames(payeeIds),
    enabled: payeeIds.length > 0,
  });
  const [draft, setDraft] = useState<Draft | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    if (!draft) return;
    setBusy(true);
    try {
      // A Shops refund settled with a Stripe refund id is checked WITH Stripe first (shop-checkout); the RPC takes only "other: ...".
      if (draft.action === "settle" && draft.row.kind === "shop_refund" && !/^\s*other:/i.test(draft.ref)) {
        try {
          await adminSettleHeldShopRefund(draft.row.id, draft.ref.trim(), draft.note);
        } catch (e) {
          toast.error(shopsErrorMessage(e));
          return;
        }
        toast.success("Marked settled by hand.");
        setDraft(null);
        await qc.invalidateQueries({ queryKey: ["admin", "payouts-held-for-review"] });
        return;
      }
      const { error: err } = draft.action === "release"
        ? await supabase.rpc("admin_payout_release",
          { p_kind: draft.row.kind, p_id: draft.row.id, p_note: draft.note, p_confirm_no_transfer: draft.confirmed })
        : await supabase.rpc("admin_payout_settle_by_hand",
          { p_kind: draft.row.kind, p_id: draft.row.id, p_ref: draft.ref, p_amount_cents: toCents(draft.amount) ?? 0, p_note: draft.note });
      if (err) {
        toast.error(
          (draft.action === "release" ? rpcErrorMessage("admin_payout_release", err) : rpcErrorMessage("admin_payout_settle_by_hand", err))
            ?? "That didn't go through. Try again.",
        );
        return;
      }
      toast.success(draft.action === "release" ? "Released to the automatic queue." : "Marked settled by hand.");
      setDraft(null);
      await qc.invalidateQueries({ queryKey: ["admin", "payouts-held-for-review"] });
    } finally {
      setBusy(false);
    }
  };

  const canSubmit = (d: Draft) => !busy && !!d.note.trim() && (d.action === "release"
    ? d.confirmed
    : !!d.ref.trim() && (toCents(d.amount) ?? 0) > 0 && d.confirmed);

  return (
    <AdminCard>
      <h3 className="text-sm font-semibold">Held for review</h3>
      <p className="text-xs text-muted-foreground">
        These won't pay themselves. Check Stripe first. Release one once the cause is fixed, or pay it by hand and mark it settled.
      </p>
      {isLoading && <p className="text-xs text-muted-foreground" data-testid="held-loading">Loading…</p>}
      {error && <p className="text-xs text-destructive-ink" role="alert">{(error as { userMessage?: string }).userMessage ?? "Couldn't load the held payouts."}</p>}
      {!isLoading && !error && (rows ?? []).length === 0 && <p className="text-xs text-muted-foreground">Nothing is held for review.</p>}
      <ul className="mt-2 space-y-2">
        {(rows ?? []).map((r) => (
          <li key={`${r.kind}-${r.id}`} className="rounded border p-2 text-sm" data-testid="held-row">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span>{KIND_LABEL[r.kind]} · {money(r.amount_cents)}</span>
              <span className="text-xs text-muted-foreground">{r.stripe_group ?? "no Stripe group"}</span>
            </div>
            <p className="text-xs text-muted-foreground">
              Payee {r.payee_id ? `${names?.[r.payee_id] ?? "name not loaded"} (${r.payee_id})` : "deleted"} · payout account {r.payee_account ?? "none"}
            </p>
            <p className="text-xs text-muted-foreground break-words">{heldReasonWords(r.reason)}</p>
            {(r.sibling_refs ?? []).length > 0 && (
              <p className="text-xs" data-testid="held-siblings">
                Already used by this payee's other payouts (never reuse): {(r.sibling_refs ?? []).map((s) => `${s.ref} (${money(s.amount_cents)})`).join(", ")}
              </p>
            )}
            <div className="mt-1 flex flex-wrap gap-2">
              <Button size="sm" variant="outline" onClick={() => setDraft({ row: r, action: "release", note: "", ref: "", amount: "", confirmed: false })}>Release to automatic</Button>
              <Button size="sm" variant="outline"
                onClick={() => setDraft({ row: r, action: "settle", note: "", ref: "", amount: (r.amount_cents / 100).toFixed(2), confirmed: false })}>
                Mark settled by hand
              </Button>
            </div>
            {draft && draft.row.id === r.id && draft.row.kind === r.kind && (
              <div className="mt-2 space-y-2">
                {draft.action === "settle" && (
                  <>
                    <Input aria-label="Stripe id" placeholder={r.kind.endsWith("refund") ? "re_... or other: how it was refunded" : "tr_... / po_... or other: how it was paid"}
                      value={draft.ref} onChange={(e) => setDraft({ ...draft, ref: e.target.value })} />
                    <Input aria-label="Amount" inputMode="decimal" value={draft.amount} readOnly={WHOLE_AMOUNT_ONLY.has(r.kind)}
                      onChange={(e) => setDraft({ ...draft, amount: e.target.value })} />
                    {WHOLE_AMOUNT_ONLY.has(r.kind) && (
                      <p className="text-xs text-muted-foreground">A Shops refund is settled only for its whole amount.</p>
                    )}
                  </>
                )}
                <Textarea aria-label="Note" placeholder="Why" value={draft.note} onChange={(e) => setDraft({ ...draft, note: e.target.value })} />
                <label className="flex min-h-11 items-start gap-2 text-xs">
                  <input type="checkbox" className="h-4 w-4 min-h-0 min-w-0 shrink-0" style={{ accentColor: "hsl(var(--primary))" }} checked={draft.confirmed} onChange={(e) => setDraft({ ...draft, confirmed: e.target.checked })} />
                  {draft.action === "release"
                    ? "I confirmed in Stripe that no transfer or refund for this row was made outside the app"
                    : "I checked this Stripe id (or payment) is for this row: the right payee and amount"}
                </label>
                <div className="flex flex-wrap gap-2">
                  <Button size="sm" disabled={!canSubmit(draft)} onClick={submit}>
                    {draft.action === "release" ? "Release" : "Mark settled"}
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => setDraft(null)}>Cancel</Button>
                </div>
              </div>
            )}
          </li>
        ))}
      </ul>
    </AdminCard>
  );
}
