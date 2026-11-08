import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { unwrap } from "@/lib/supabaseResult";
import { AdminCard } from "../AdminViewShell";
import { ReportErrorScreen } from "@/components/ui/ReportErrorScreen";

/**
 * H3 (Declutter buy audit 11-08): where buyers drop off. The last 7 days of the first-party buy funnel
 * (declutter_funnel_counts, admins only, test accounts left out; migration 20261108203450): each step's events and
 * distinct people, and each Stripe decline code under "Payment failed". No card data, email or IP is stored.
 * Guard: src/test/declutterBuyFunnel.test.ts.
 */
type Row = { step: string; detail: string | null; events: number; people: number };

const STEP_WORDS: Record<string, string> = {
  item_view: "Viewed an item",
  buy_now_tap: "Tapped Buy now",
  checkout_opened: "Opened the payment page",
  returned_from_stripe: "Came back from the payment page",
  paid: "Paid",
  payment_failed: "Payment failed",
};

export function DeclutterFunnelCard() {
  const q = useQuery({
    queryKey: ["admin", "declutter-funnel", 7],
    queryFn: async () => (unwrap(await supabase.rpc("declutter_funnel_counts", { p_days: 7 })) ?? []) as Row[],
  });
  return (
    <AdminCard title="Declutter buying, last 7 days" subtitle="How far buyers get, step by step. People are counted once per account or device.">
      {q.isLoading ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : q.isError ? (
        <>
          <ReportErrorScreen source="DeclutterFunnelCard" title="Couldn't load the Declutter buying numbers." />
          <p className="text-ds-13 text-destructive-ink" role="alert">Couldn't load the numbers. Try again later.</p>
        </>
      ) : (q.data ?? []).length === 0 ? (
        <p className="text-sm text-muted-foreground">No buying steps in the last 7 days.</p>
      ) : (
        <table className="w-full text-sm" data-declutter-funnel="">
          <thead>
            <tr className="text-left text-muted-foreground">
              <th className="py-1 font-medium">Step</th>
              <th className="py-1 text-right font-medium">People</th>
              <th className="py-1 text-right font-medium">Times</th>
            </tr>
          </thead>
          <tbody>
            {(q.data ?? []).map((r) => (
              <tr key={`${r.step}:${r.detail ?? ""}`} className="border-t border-border">
                <td className="py-1">{STEP_WORDS[r.step] ?? r.step}{r.detail ? <span className="text-muted-foreground"> · {r.detail.replace(/_/g, " ")}</span> : null}</td>
                <td className="py-1 text-right tabular-nums">{r.people}</td>
                <td className="py-1 text-right tabular-nums">{r.events}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </AdminCard>
  );
}
