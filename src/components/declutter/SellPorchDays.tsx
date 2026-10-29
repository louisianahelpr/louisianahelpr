/**
 * Porch weekday chips on the sell form (owner 2026-10-29, builder 23's leftover): while "Porch pickup"
 * is ticked, the seller taps the weekdays they put things out. Per SELLER (every listing), saved as
 * they tap (declutter_set_porch_days). None picked = the weekdays of their pickup times, as before.
 * Hidden until the migration is on the server (PGRST202), and on a failed read (said, not silent).
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { fetchMyPorchDays, saveMyPorchDays, PORCH_DAYS_NOT_DEPLOYED } from "@/lib/declutter/porchDays";
import { declutterErrorMessage } from "@/lib/declutter/errors";
import { ErrorState } from "@/components/ui/ErrorState";
import { WEEKDAYS } from "./declutterUi";

const KEY = ["declutter", "my-porch-days"] as const;

export function SellPorchDays() {
  const qc = useQueryClient();
  const mine = useQuery({ queryKey: KEY, queryFn: fetchMyPorchDays });
  const save = useMutation({
    mutationFn: saveMyPorchDays,
    onSuccess: (days) => qc.setQueryData(KEY, days.length ? days : null),
  });
  if (mine.data === PORCH_DAYS_NOT_DEPLOYED || mine.isLoading) return null;
  if (mine.isError) return <ErrorState variant="inline" title="We couldn't load your porch days." body={declutterErrorMessage(mine.error)} onRetry={() => void mine.refetch()} />;
  const picked = mine.data ?? [];
  const toggle = (d: number) => save.mutate(picked.includes(d) ? picked.filter((x) => x !== d) : [...picked, d].sort((a, b) => a - b));
  return (
    <div className="space-y-2" role="group" aria-labelledby="sell-porch-days" data-porch-days="">
      <p id="sell-porch-days" className="text-ds-14 font-semibold text-foreground">Porch days</p>
      <ul className="flex flex-wrap gap-2">
        {WEEKDAYS.map((name, d) => {
          const on = picked.includes(d);
          return (
            <li key={name}>
              <button type="button" aria-pressed={on} aria-label={name} disabled={save.isPending}
                onClick={() => toggle(d)}
                className={`min-h-11 min-w-11 rounded-full border px-3 text-ds-14 font-semibold ${on ? "btn-grad-primary border-transparent text-primary-foreground" : "border-border bg-card text-foreground"}`}>
                {name.slice(0, 3)}
              </button>
            </li>
          );
        })}
      </ul>
      <p className="text-ds-13 text-muted-foreground">
        {picked.length ? "Buyers pick one of these days. They apply to all your listings." : "None picked: buyers pick one of your pickup-time days."}
      </p>
      {save.isError && <p role="alert" className="text-ds-13 text-foreground">{declutterErrorMessage(save.error)}</p>}
    </div>
  );
}
