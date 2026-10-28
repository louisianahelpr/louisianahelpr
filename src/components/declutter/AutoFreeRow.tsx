/**
 * "Free on day 12" in Manage listing (Q2430, owner 2026-10-27): "If it hasn't sold by day 12, make it
 * free" -- the evening price-drop sweep makes it free (no fee, as any free listing), one last chance
 * before the 14-day haul-away, and its watchers are told. Hidden until the migration is on prod.
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Switch } from "@/components/ui/switch";
import { declutterErrorMessage } from "@/lib/declutter/errors";
import { fetchAutoFree, setAutoFree } from "@/lib/declutter/api";

export function AutoFreeRow({ itemId, rowClassName }: { itemId: string; rowClassName: string }) {
  const qc = useQueryClient();
  const key = ["declutter", "auto-free", itemId];
  const state = useQuery({ queryKey: key, queryFn: () => fetchAutoFree(itemId) });
  const flip = useMutation({
    mutationFn: (on: boolean) => setAutoFree(itemId, on),
    onSuccess: (on) => {
      toast.success(on ? "If it hasn't sold by day 12, it becomes free." : "It won't become free on day 12.");
      void qc.invalidateQueries({ queryKey: key });
    },
    onError: (err) => toast.error(declutterErrorMessage(err)),
  });
  if (state.data === "not_deployed") return null;
  if (state.isError) {
    return (
      <li className={rowClassName}>
        <p className="text-sm" role="alert">{declutterErrorMessage(state.error)}</p>
      </li>
    );
  }
  const on = state.data === true;
  return (
    <li className={rowClassName}>
      <span className="flex-1 min-w-0">
        <span id={`auto-free-${itemId}`} className="block text-ds-15 font-semibold">Free on day 12</span>
        <span className="block text-ds-13 text-muted-foreground">If it hasn't sold by day 12, make it free: one last chance before haul-away. Already past day 12? It becomes free tonight.</span>
        {/* Audit 2 SE2-3: both switches could be on with no word that day 12 wins (declutter_auto_free_due clears the stop). */}
        {on && <span className="block text-ds-13 text-muted-foreground" data-auto-free-wins="">This wins over a stopped price: on day 12 it's free.</span>}
      </span>
      <Switch aria-labelledby={`auto-free-${itemId}`} checked={on} disabled={state.isLoading || flip.isPending} onCheckedChange={(v) => flip.mutate(v)} />
    </li>
  );
}
