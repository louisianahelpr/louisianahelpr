/**
 * "If it doesn't sell, make it free after __ days" (OWN-FREE, replacing Q2430's fixed "Free on day 12" switch):
 * Never, 7, 14, 21 or 30 days (src/lib/declutter/autoFree.ts). The evening price-drop sweep makes it free (no fee,
 * as any free listing), and its watchers are told. Shown in Manage listing and on a saved draft's last sell step;
 * a new listing's one screen holds the choice until Post (useSellFlowState). Hidden until migration
 * 20261030030408 is on prod (PGRST202 -> "not_deployed").
 */
import { useId } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { ErrorState } from "@/components/ui/ErrorState";
import { declutterErrorMessage } from "@/lib/declutter/errors";
import { fetchAutoFreeDays, setAutoFreeDays } from "@/lib/declutter/api";
import { AUTO_FREE_LABEL, AUTO_FREE_OPTIONS, autoFreeDaysFrom, autoFreeExplainer, autoFreeSaved, autoFreeValue } from "@/lib/declutter/autoFree";

/**
 * One row, the label on the left and a native labelled dropdown on the right (LEAD-FREE-AFTER-DROPDOWN, owner
 * 2026-10-31: five chips took two lines), then the line under it. Presentational: the caller owns the value. The one
 * control for this choice: Declutter settings, Manage listing and a saved draft's last sell step all use it.
 */
export function AutoFreeChoice({ days, onChange }: { days: number | null; onChange: (days: number | null) => void }) {
  const id = useId();
  return (
    <div className="space-y-2" data-auto-free={autoFreeValue(days)}>
      <div className="flex items-center justify-between gap-3" data-auto-free-row="">
        <label htmlFor={id} className="min-w-0 flex-1 text-ds-14 font-semibold text-foreground">{AUTO_FREE_LABEL}</label>
        <select id={id} value={autoFreeValue(days)} onChange={(e) => onChange(autoFreeDaysFrom(e.target.value))}
          className="h-11 w-auto max-w-[65%] shrink-0 rounded-[12px] border border-border bg-card px-3 text-ds-14 text-foreground focus:border-primary focus:outline-none focus-visible:ring-2 focus-visible:ring-ring">
          {AUTO_FREE_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
      </div>
      <p className="text-ds-13 text-muted-foreground">{autoFreeExplainer(days)}</p>
      {/* Audit 2 SE2-3: with drops stopped, say that the day count wins (declutter_auto_free_due clears the stop). */}
      {days !== null && <p className="text-ds-13 text-muted-foreground" data-auto-free-wins="">This wins over a stopped price: on day {days} it's free.</p>}
    </div>
  );
}

/** The saved choice on a listing that exists (Manage listing, a saved draft's last step). */
export function AutoFreeRow({ itemId, rowClassName, as = "li" }: { itemId: string; rowClassName: string; as?: "li" | "div" }) {
  const qc = useQueryClient();
  const key = ["declutter", "auto-free", itemId];
  const state = useQuery({ queryKey: key, queryFn: () => fetchAutoFreeDays(itemId) });
  const pick = useMutation({
    mutationFn: (days: number | null) => setAutoFreeDays(itemId, days),
    onSuccess: (days) => {
      toast(autoFreeSaved(days));
      void qc.invalidateQueries({ queryKey: key });
    },
    onError: (err) => toast.error(declutterErrorMessage(err)),
  });
  const Row = as;
  if (state.data === "not_deployed") return null;
  if (state.isError) {
    return <Row className={rowClassName}><ErrorState variant="inline" title="We couldn't load this setting." body={declutterErrorMessage(state.error)} onRetry={() => void state.refetch()} /></Row>;
  }
  if (state.isLoading) return null;
  const days = pick.isPending ? (pick.variables ?? null) : (state.data ?? null);
  return (
    <Row className={rowClassName}>
      <div className="min-w-0 flex-1">
        <AutoFreeChoice days={days} onChange={(d) => { if (!pick.isPending && d !== days) pick.mutate(d); }} />
      </div>
    </Row>
  );
}
