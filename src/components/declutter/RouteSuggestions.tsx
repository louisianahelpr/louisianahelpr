/**
 * "On your way" (owner request 2026-10-27, multi-stop Declutter delivery part 3): up to 3 open
 * deliveries that add little to the Helpr's route, as "+$X pay, about N extra minutes", each taken
 * with one tap through the existing accept path (helpr_task_accept) at the pickup time
 * helpr_route_suggestions found inside the seller's pickup times. Shown under My route (after
 * taking a delivery) and on an open delivery the Helpr is looking at. Area words and rough miles
 * only: no address before the delivery is theirs. The pay is the take-home figure Deliver for pay
 * already shows; never a fee.
 */
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { useHiredPayoutPrompt } from "@/components/payouts/useHiredPayoutPrompt";
import { HiredPayoutSetupDialog } from "@/components/payouts/HiredPayoutSetupDialog";
import { declutterErrorMessage } from "@/lib/declutter/errors";
import { formatPrice } from "@/lib/declutter/distance";
import { acceptTask, fetchRouteSuggestions, type RouteSuggestion } from "@/lib/helprTasks/api";
import { invalidateTasks } from "./useTaskSteps";
import { DELIVERY_ADDRESSES_SHOW } from "@/lib/declutter/deliveryAddressWords";

const when = (iso: string) => new Date(iso).toLocaleString([], { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });

function SuggestionRow({ s, onTaken }: { s: RouteSuggestion; onTaken: () => void }) {
  const qc = useQueryClient();
  const { user } = useCurrentUser();
  const hiredPayout = useHiredPayoutPrompt();
  const take = useMutation({
    mutationFn: () => acceptTask(s.task_id, s.pickup_slot_start),
    onSuccess: () => {
      toast(`Added to your route. Pick it up ${when(s.pickup_slot_start)}.`);
      invalidateTasks(qc);
      onTaken();
      if (user?.id) void hiredPayout.offer(user.id);
    },
    onError: (err) => toast.error(declutterErrorMessage(err)),
  });
  return (
    <li className="rounded-2xl border border-border bg-card p-4 space-y-2">
      <p className="text-ds-15 font-semibold leading-snug line-clamp-2" title={s.title}>{s.title}</p>
      <p className="text-ds-13 text-muted-foreground">Pick up in {s.pickup_area}, drop off near {s.dropoff_area}</p>
      <p className="text-ds-15 font-semibold">
        <span className="tabular-nums text-[hsl(var(--burnt-sienna))]">+{formatPrice(s.take_home_cents)} pay</span>
        <span className="font-normal">, about {s.extra_minutes} extra {s.extra_minutes === 1 ? "minute" : "minutes"}</span>
      </p>
      <p className="text-ds-13">Pickup {when(s.pickup_slot_start)}</p>
      <button type="button" className="btn-grad-primary min-h-11 rounded-full px-4 py-2 text-sm font-semibold disabled:opacity-50"
        disabled={take.isPending} onClick={() => take.mutate()}>
        {take.isPending ? "Adding…" : "Add to my route"}
      </button>
      {hiredPayout.open && <HiredPayoutSetupDialog open onOpenChange={(o) => { if (!o) hiredPayout.close(); }} />}
    </li>
  );
}

/**
 * The suggestions for the Helpr's route, or for the route with `withTaskId` (an open delivery they
 * are looking at) added. Renders nothing while loading, on no suggestion, or on an error (it is an
 * extra; the delivery list and the route still work), except the one answer a Helpr acts on: two
 * deliveries not yet picked up.
 */
export function RouteSuggestions({ withTaskId }: { withTaskId?: string }) {
  const qc = useQueryClient();
  const q = useQuery({
    queryKey: ["helpr-tasks", "suggest", withTaskId ?? null],
    queryFn: () => fetchRouteSuggestions(withTaskId ?? null),
    meta: { persist: false },
  });
  if (q.isError) {
    console.warn("[route suggestions]", q.error);
    return null;
  }
  const data = q.data;
  if (!data) return null;
  if (data.reason === "too_many_taken" && !withTaskId) {
    return <p className="text-ds-13 text-muted-foreground">Pick up one of your deliveries to see more on your way.</p>;
  }
  if (data.reason === "too_many_releases") {
    return <p className="text-ds-13 text-muted-foreground">You backed out of 3 deliveries this week. You can take new ones again in a few days.</p>;
  }
  if (data.suggestions.length === 0) return null;
  return (
    <section className="space-y-2" aria-label="On your way">
      <h3 className="text-ds-15 font-semibold">On your way</h3>
      <ul className="space-y-2">
        {data.suggestions.map((s) => (
          <SuggestionRow key={s.task_id} s={s} onTaken={() => void qc.invalidateQueries({ queryKey: ["helpr-tasks", "suggest"] })} />
        ))}
      </ul>
      <p className="text-ds-12 text-muted-foreground">{DELIVERY_ADDRESSES_SHOW}</p>
    </section>
  );
}
