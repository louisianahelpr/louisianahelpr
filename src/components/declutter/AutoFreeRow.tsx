/**
 * "If it doesn't sell, make it free after __ days" (OWN-FREE, replacing Q2430's fixed "Free on day 12" switch):
 * Never, 7, 14, 21 or 30 days (src/lib/declutter/autoFree.ts). The evening price-drop sweep makes it free (no fee,
 * as any free listing), and its watchers are told. Shown in Manage listing and on a saved draft's last sell step;
 * a new listing's one screen holds the choice until Post (useSellFlowState). Hidden until migration
 * 20261030030408 is on prod (PGRST202 -> "not_deployed").
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { ErrorState } from "@/components/ui/ErrorState";
import { declutterErrorMessage } from "@/lib/declutter/errors";
import { fetchAutoFreeDays, setAutoFreeDays } from "@/lib/declutter/api";
import { AUTO_FREE_LABEL, AUTO_FREE_OPTIONS, autoFreeDaysFrom, autoFreeExplainer, autoFreeSaved, autoFreeValue } from "@/lib/declutter/autoFree";
import { ChipGroup } from "./DeclutterSellSteps";

/** The chips and the line under them. Presentational: the caller owns the value. */
export function AutoFreeChoice({ days, onChange }: { days: number | null; onChange: (days: number | null) => void }) {
  return (
    <div className="space-y-2" data-auto-free={autoFreeValue(days)}>
      <ChipGroup label={AUTO_FREE_LABEL} options={AUTO_FREE_OPTIONS} value={autoFreeValue(days)} onChange={(v) => onChange(autoFreeDaysFrom(v))} />
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
      toast.success(autoFreeSaved(days));
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
