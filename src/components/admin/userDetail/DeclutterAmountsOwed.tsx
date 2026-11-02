import { useState } from "react";
import { Receipt, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { useInstantQuery } from "@/hooks/useInstantQuery";
import { report } from "@/lib/errorLogger";
import { userFacingError } from "@/lib/userFacingError";

/**
 * Q1928 gap 1: what this member still owes from Declutter refunds (a card cost billed to a seller who was out, at
 * fault, or a Helpr at fault), and a way to clear one when the ban, flag or ruling behind it is overturned. The server
 * (declutter_admin_fee_debts / declutter_admin_waive_fee_debt, 20261102065446) checks admin itself, needs a reason,
 * writes admin_audit_log and tells the member once; this card only lists and asks.
 */
export interface OwedRow {
  id: string;
  amount_cents: number;
  remaining_cents: number;
  created_at: string;
  reason: string;
  items: string | null;
  fee_estimated: boolean;
  waived_at: string | null;
  waived_cents: number | null;
  waive_note: string | null;
}

const REASON_WORDS: Record<string, string> = {
  seller_out: "Buyer paid while the account couldn't sell",
  seller_backed_out: "Seller backed out of a paid sale",
  seller_no_show: "Seller didn't show",
  not_as_described: "Item not as described",
  helpr_fault: "Helpr's fault on a delivery",
};
const owedReasonWords = (reason: string) => REASON_WORDS[reason] ?? "Refund";
const dollars = (cents: number) => `$${(cents / 100).toFixed(2)}`;

export function DeclutterAmountsOwed({ userId }: { userId: string }) {
  const [clearing, setClearing] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);
  const { data: rows, isInitialLoading, isError, refetch } = useInstantQuery<OwedRow[]>({
    key: ["admin-declutter-amounts-owed", userId],
    fallback: [],
    fetcher: async () => {
      const { data, error } = await supabase.rpc("declutter_admin_fee_debts", { p_user: userId });
      if (error) {
        // PGRST202: the function is not deployed yet (the migration lands first); show nothing rather than an error.
        if (error.code === "PGRST202") return [];
        report(error, { tags: { source: "DeclutterAmountsOwed.load" } });
        throw error;
      }
      return (data ?? []) as OwedRow[];
    },
  });

  const clear = async (id: string) => {
    const why = note.trim();
    if (!why) {
      toast.error("Say why you're clearing it.");
      return;
    }
    setSaving(true);
    const { data, error } = await supabase.rpc("declutter_admin_waive_fee_debt", { p_debt_id: id, p_note: why });
    setSaving(false);
    if (error) {
      toast.error(userFacingError(error, "Couldn't clear that amount. Try again."));
      return;
    }
    const answer = data as { result?: string } | null;
    if (answer?.result !== "waived" && answer?.result !== "already_waived") {
      toast.error("Couldn't clear that amount. Try again.");
      return;
    }
    toast.success("Cleared. The member was told.");
    setClearing(null);
    setNote("");
    refetch();
  };

  if (isError) {
    return <p className="text-ds-11 text-destructive-ink">Couldn't load what this member owes from Declutter refunds.</p>;
  }
  if (isInitialLoading || rows.length === 0) return null;
  return (
    <div className="space-y-2" data-testid="declutter-amounts-owed">
      <p className="text-ds-10 uppercase tracking-wider text-muted-foreground font-medium flex items-center gap-1.5">
        <Receipt className="w-3.5 h-3.5" /> Owed from Declutter refunds
      </p>
      {rows.map((r) => (
        <div key={r.id} className="rounded-ds-sm liquid-glass p-3 space-y-2">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <p className="text-ds-13 font-medium">{owedReasonWords(r.reason)}</p>
              <p className="text-ds-11 text-muted-foreground break-words">
                {r.items ? `${r.items} · ` : ""}{new Date(r.created_at).toLocaleDateString()}
                {r.fee_estimated ? " · estimated" : ""}
              </p>
            </div>
            <p className="text-ds-13 tabular-nums shrink-0">
              {r.waived_at
                ? `Cleared ${dollars(r.waived_cents ?? 0)}`
                : r.remaining_cents > 0 ? `${dollars(r.remaining_cents)} of ${dollars(r.amount_cents)}` : "Paid back"}
            </p>
          </div>
          {r.waived_at && r.waive_note ? <p className="text-ds-11 text-muted-foreground break-words">Why: {r.waive_note}</p> : null}
          {!r.waived_at && r.remaining_cents > 0 && clearing !== r.id ? (
            <Button variant="outline" size="sm" onClick={() => { setClearing(r.id); setNote(""); }}>
              Clear what's left
            </Button>
          ) : null}
          {clearing === r.id ? (
            <div className="space-y-2">
              <Textarea
                aria-label="Why you're clearing it"
                placeholder="Why (for example: ban overturned on appeal)"
                value={note}
                maxLength={500}
                onChange={(e) => setNote(e.target.value)}
                className="text-ds-13 resize-none"
              />
              <div className="flex gap-2">
                <Button variant="outline" size="sm" disabled={saving} onClick={() => setClearing(null)}>
                  Cancel
                </Button>
                <Button size="sm" disabled={saving} onClick={() => clear(r.id)}>
                  {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin mr-1" /> : null}
                  Clear {dollars(r.remaining_cents)}
                </Button>
              </div>
            </div>
          ) : null}
        </div>
      ))}
    </div>
  );
}
