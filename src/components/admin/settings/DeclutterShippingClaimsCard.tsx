import { useState } from "react";
import { withoutTestPeople } from "@/components/admin/seedRows";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { useFeature } from "@/hooks/useFeature";
import { unwrap } from "@/lib/supabaseResult";
import { userFacingError } from "@/lib/userFacingError";
import { offerCentsFromInput } from "@/lib/declutter/refundRequests";
import { formatPrice } from "@/lib/declutter/distance";
import { ADMIN_DELETED_ACCOUNT_LABEL } from "@/lib/deletedPerson";
import { rpcErrorMessage } from "@/components/admin/adminRpcErrorCopy";
import { AdminCard } from "../AdminViewShell";
import { ReportErrorScreen } from "@/components/ui/ReportErrorScreen";

/**
 * Declutter shipping, the admin's hand steps (owner 11-03: the rest of a carrier claim reaches the seller BY AN ADMIN
 * BY HAND, never automatically). Shown only while declutter_shipping is on for this admin; every RPC also checks
 * the switch and the admin role itself, and writes admin_audit_log.
 *  - Record a carrier claim (declutter_admin_record_ship_claim, 20261103210119): the claim first pays what the seller
 *    still owes on that order; the rest is due to the seller.
 *  - To send by hand (declutter_admin_ship_claims_due / declutter_admin_mark_ship_claim_sent, 20261103214253):
 *    "Send $X to <seller> by hand", then "Mark sent" with the transfer id or check number. Nothing here moves money.
 *  - Ask for the item back (declutter_admin_request_return_label, 20261103212046): a return label for an order
 *    refunded as damaged or not as described; the buyer prints it from their order (ReturnLabelPanel).
 * Guard: src/components/admin/settings/DeclutterShippingClaimsCard.test.tsx.
 */
type ClaimDue = { claim_id: string; order_id: string; seller_id: string; claim_ref: string; seller_due_cents: number; created_at: string };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DUE_KEY = ["admin", "declutter-ship-claims-due"] as const;

async function fetchClaimsDue(): Promise<{ rows: ClaimDue[]; names: Record<string, string> }> {
  const res = await supabase.rpc("declutter_admin_ship_claims_due");
  let rows: ClaimDue[];
  try {
    rows = (unwrap(res) ?? []) as ClaimDue[];
  } catch (thrown) {
    const words = rpcErrorMessage("declutter_admin_ship_claims_due", thrown);
    if (words && thrown instanceof Error && Object.isExtensible(thrown)) Object.assign(thrown, { userMessage: words });
    throw thrown;
  }
  // Owner 2026-11-04: a test seller's claim never shows on a real admin screen.
  rows = await withoutTestPeople(rows, (r) => [r.seller_id]);
  const ids = [...new Set(rows.map((r) => r.seller_id).filter(Boolean))];
  if (ids.length === 0) return { rows, names: {} };
  const profs = unwrap(await supabase.from("profiles").select("user_id, full_name").in("user_id", ids)) ?? [];
  const names: Record<string, string> = {};
  for (const p of profs as { user_id: string; full_name: string | null }[]) if (p.full_name) names[p.user_id] = p.full_name;
  return { rows, names };
}

const FAILED = "That didn't go through. Try again.";

export function DeclutterShippingClaimsCard() {
  const on = useFeature("declutter_shipping");
  if (!on) return null;
  return (
    <AdminCard title="Declutter shipping claims and returns" subtitle="Carrier claims are sent to the seller by hand. Nothing here moves money by itself.">
      <div className="space-y-6">
        <ClaimsDue />
        <RecordClaim />
        <ReturnLabelRequest />
      </div>
    </AdminCard>
  );
}

function ClaimsDue() {
  const due = useQuery({ queryKey: DUE_KEY, queryFn: fetchClaimsDue });
  const qc = useQueryClient();
  const [marking, setMarking] = useState<string | null>(null);
  const [ref, setRef] = useState("");
  const [saving, setSaving] = useState(false);

  const markSent = async (claimId: string) => {
    const sent = ref.trim();
    if (!sent) {
      toast.error("Say how you sent it: the transfer id or check number.");
      return;
    }
    setSaving(true);
    const { data, error } = await supabase.rpc("declutter_admin_mark_ship_claim_sent", { p_claim_id: claimId, p_sent_ref: sent });
    setSaving(false);
    if (error) {
      toast.error(rpcErrorMessage("declutter_admin_mark_ship_claim_sent", error) ?? userFacingError(error, FAILED));
      return;
    }
    const result = (data as { result?: string } | null)?.result;
    if (result !== "sent" && result !== "already_sent") {
      toast.error(FAILED);
      return;
    }
    toast("Marked sent. The seller was told.");
    setMarking(null);
    setRef("");
    void qc.invalidateQueries({ queryKey: DUE_KEY });
  };

  return (
    <section className="space-y-2" data-testid="ship-claims-due">
      <h3 className="text-ds-14 font-semibold">To send by hand</h3>
      {due.isPending ? (
        <p className="text-ds-13 text-muted-foreground">Loading…</p>
      ) : due.isError ? (
        <>
          <ReportErrorScreen source="DeclutterShippingClaimsCard" title="Couldn't load the claims to send." />
          <p className="text-ds-13 text-destructive-ink" role="alert">
            Couldn't load the claims to send. {(due.error as { userMessage?: string }).userMessage ?? ""}
          </p>
        </>
      ) : due.data.rows.length === 0 ? (
        <p className="text-ds-13 text-muted-foreground">Nothing to send. Every recorded claim is settled.</p>
      ) : (
        due.data.rows.map((c) => (
          <div key={c.claim_id} className="rounded-ds-sm border border-border p-3 space-y-2" data-claim-due={c.claim_id}>
            <p className="text-ds-14 font-medium [overflow-wrap:anywhere]">
              Send {formatPrice(c.seller_due_cents)} to {due.data.names[c.seller_id] ?? ADMIN_DELETED_ACCOUNT_LABEL} by hand
            </p>
            <p className="text-ds-12 text-muted-foreground [overflow-wrap:anywhere]">
              Claim {c.claim_ref} · order {c.order_id.slice(0, 8)} · recorded {new Date(c.created_at).toLocaleDateString()}
            </p>
            {marking === c.claim_id ? (
              <div className="space-y-2">
                <Input aria-label="Transfer id or check number" placeholder="Transfer id or check number" value={ref} maxLength={200} onChange={(e) => setRef(e.target.value)} />
                <div className="flex justify-end gap-2">
                  <Button variant="outline" size="sm" disabled={saving} onClick={() => setMarking(null)}>Cancel</Button>
                  <Button size="sm" disabled={saving} onClick={() => void markSent(c.claim_id)}>Mark sent</Button>
                </div>
              </div>
            ) : (
              <div className="flex justify-end">
                <Button variant="outline" size="sm" onClick={() => { setMarking(c.claim_id); setRef(""); }}>Mark sent</Button>
              </div>
            )}
          </div>
        ))
      )}
    </section>
  );
}

function RecordClaim() {
  const qc = useQueryClient();
  const [orderId, setOrderId] = useState("");
  const [claimRef, setClaimRef] = useState("");
  const [amount, setAmount] = useState("");
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);

  const record = async () => {
    const id = orderId.trim();
    const cents = offerCentsFromInput(amount);
    if (!UUID.test(id)) return void toast.error("Paste the order id (the long id from the order).");
    if (!claimRef.trim()) return void toast.error("Enter the claim number from EasyPost or the carrier.");
    if (cents == null) return void toast.error("Enter the amount the claim paid, above $0.");
    if (!note.trim()) return void toast.error("Say what the claim was for.");
    setSaving(true);
    const { data, error } = await supabase.rpc("declutter_admin_record_ship_claim", { p_order_id: id, p_claim_ref: claimRef.trim(), p_amount_cents: cents, p_note: note.trim() });
    setSaving(false);
    if (error) {
      toast.error(rpcErrorMessage("declutter_admin_record_ship_claim", error) ?? userFacingError(error, FAILED));
      return;
    }
    const r = data as { result?: string; debt_paid_cents?: number; seller_due_cents?: number } | null;
    if (r?.result !== "recorded" && r?.result !== "already_recorded") {
      toast.error(FAILED);
      return;
    }
    const owedPaid = r.debt_paid_cents ?? 0;
    const due = r.seller_due_cents ?? 0;
    const first = r.result === "already_recorded" ? "This claim was already recorded." : "Claim recorded.";
    const paid = owedPaid > 0 ? ` ${formatPrice(owedPaid)} paid what the seller owed on this order.` : "";
    const rest = due > 0 ? ` Send ${formatPrice(due)} to the seller by hand (listed above).` : " Nothing is left to send.";
    toast(`${first}${paid}${rest}`);
    setOrderId(""); setClaimRef(""); setAmount(""); setNote("");
    void qc.invalidateQueries({ queryKey: DUE_KEY });
  };

  return (
    <section className="space-y-2" data-testid="ship-claim-record">
      <h3 className="text-ds-14 font-semibold">Record a carrier claim</h3>
      <p className="text-ds-12 text-muted-foreground">For a shipped order refunded as lost or broken in the mail, once the carrier pays the claim.</p>
      <Input aria-label="Order id" placeholder="Order id" value={orderId} onChange={(e) => setOrderId(e.target.value)} />
      <Input aria-label="Claim number" placeholder="Claim number" value={claimRef} maxLength={200} onChange={(e) => setClaimRef(e.target.value)} />
      <Input aria-label="Amount the claim paid" placeholder="Amount paid, like 24.50" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} />
      <Textarea aria-label="What the claim was for" placeholder="What the claim was for" value={note} maxLength={500} onChange={(e) => setNote(e.target.value)} className="text-ds-13 resize-none" />
      <div className="flex justify-end">
        <Button size="sm" disabled={saving} onClick={() => void record()}>Record claim</Button>
      </div>
    </section>
  );
}

function ReturnLabelRequest() {
  const [orderId, setOrderId] = useState("");
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);

  const ask = async () => {
    const id = orderId.trim();
    if (!UUID.test(id)) return void toast.error("Paste the order id (the long id from the order).");
    if (!note.trim()) return void toast.error("Say why the item should come back.");
    setSaving(true);
    const { data, error } = await supabase.rpc("declutter_admin_request_return_label", { p_order_id: id, p_note: note.trim() });
    setSaving(false);
    if (error) {
      toast.error(rpcErrorMessage("declutter_admin_request_return_label", error) ?? userFacingError(error, FAILED));
      return;
    }
    const r = data as { result?: string; state?: string } | null;
    if (r?.result === "requested") {
      toast("Return label asked for. The buyer is told when it's ready to print.");
    } else if (r?.result === "already_requested") {
      toast(r.state === "failed" ? "A return label was already asked for and couldn't be made. Arrange this return by hand." : "A return label was already asked for on this order.");
    } else {
      toast.error(FAILED);
      return;
    }
    setOrderId(""); setNote("");
  };

  return (
    <section className="space-y-2" data-testid="return-label-request">
      <h3 className="text-ds-14 font-semibold">Request a return label</h3>
      <p className="text-ds-12 text-muted-foreground">For a delivered order refunded as damaged or not as described. The seller pays for the label; the buyer prints it from their order.</p>
      <Input aria-label="Order id for the return" placeholder="Order id" value={orderId} onChange={(e) => setOrderId(e.target.value)} />
      <Textarea aria-label="Why the item should come back" placeholder="Why the item should come back" value={note} maxLength={500} onChange={(e) => setNote(e.target.value)} className="text-ds-13 resize-none" />
      <div className="flex justify-end">
        <Button size="sm" disabled={saving} onClick={() => void ask()}>Request a return label</Button>
      </div>
    </section>
  );
}
