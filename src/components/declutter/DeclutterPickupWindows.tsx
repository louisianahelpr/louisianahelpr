/**
 * The seller's pickup times where buyers need them (deep audit #2 + #58, lead 2026-10-28):
 *  - ItemPickupTimes: "Pickup times: Mon–Fri 5–8 PM" on the item page.
 *  - PickupSlotPicker: the buyer's booking picker, day chips then time chips, every one inside the seller's
 *    windows and before the 7-day deadline (src/lib/declutter/pickupSlots.ts, the server's own rule), never a
 *    free date and 12-hour wheel that the server then refuses.
 * Both read through SECURITY DEFINER reads (20261028195840); before those are deployed they return null and the
 * screens keep what they showed before.
 */
import { useMemo, useState, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { ErrorState } from "@/components/ui/ErrorState";
import { fetchItemPickupWindows, fetchOrderPickupWindows } from "@/lib/declutter/handover";
import { fetchSamePickupSlot, fetchTaskPickupWindows } from "@/lib/helprTasks/api";
import { declutterErrorMessage } from "@/lib/declutter/errors";
import { pickupDays, windowsSummary } from "@/lib/declutter/pickupSlots";
import { Chip } from "./DeclutterFilterPanel";
import { DateTimeField } from "@/components/DateTimeField";

export function ItemPickupTimes({ itemId, label = "Pickup times" }: { itemId: string; label?: string }) {
  const q = useQuery({ queryKey: ["declutter", "item-pickup-windows", itemId], queryFn: () => fetchItemPickupWindows(itemId) });
  if (q.isError) return <ErrorState variant="inline" title="We couldn't load the pickup times." body={declutterErrorMessage(q.error)} onRetry={() => void q.refetch()} />;
  const line = q.data ? windowsSummary(q.data) : "";
  if (!line) return null;
  return <p className="text-sm" data-testid="declutter-pickup-times">{label}: <span className="font-medium">{line}</span></p>;
}

/**
 * Day chips, then that day's time chips. `onPick` gets the slot's ISO start (null while none is chosen).
 * `fallback` renders when the reads are not deployed yet (the old free picker).
 * An order (the buyer booking) or an OPEN delivery task (the Helpr accepting it: helpr_task_pickup_windows,
 * 20261028232930, the same chips and the same rule).
 */
export function PickupSlotPicker({ orderId, taskId, value, onPick, fallback, enabled = true, own = false, current = null, noTimes = null }: {
  orderId?: string;
  taskId?: string;
  value: string | null;
  onPick: (iso: string | null) => void;
  fallback: ReactNode;
  /**
   * Shown under "No pickup times are open" (LEAD-PLACE-TIMES: a porch buyer who cannot book at all can still report
   * it, D2-9's one exception, as the porch-day card's noDays did).
   */
  noTimes?: ReactNode;
  /** Audit 1c D3-8: false once the task is taken, so no read asks for a task that is no longer open (task_not_found). */
  enabled?: boolean;
  /** AUD31-83: the seller moving their own Helpr pickup reads "Your pickup times", not "The seller's". */
  own?: boolean;
  /** AUD31-83: the time booked now, marked among the chips ("now"). */
  current?: string | null;
}) {
  const q = useQuery(taskId
    ? { queryKey: ["helpr-tasks", "task-pickup-windows", taskId], queryFn: () => fetchTaskPickupWindows(taskId), enabled }
    : { queryKey: ["declutter", "order-pickup-windows", orderId], queryFn: () => fetchOrderPickupWindows(orderId ?? "") });
  // Slots are worked out once per read: a long-open card keeps the same chips (the server re-checks on Book).
  const days = useMemo(
    () => (q.data ? pickupDays(q.data.windows, Date.now(), q.data.latestPickupAt ? Date.parse(q.data.latestPickupAt) : null) : []),
    [q.data],
  );
  const [dayPick, setDayPick] = useState<string | null>(null);
  if (q.isError) return <ErrorState variant="inline" title="We couldn't load the seller's pickup times." body={declutterErrorMessage(q.error)} onRetry={() => void q.refetch()} />;
  if (q.isLoading) return <p className="text-sm text-muted-foreground" role="status">Loading the seller's pickup times…</p>;
  if (q.data === null) return <>{fallback}</>;
  if (days.length === 0) {
    return <div className="space-y-2"><p className="text-sm text-muted-foreground" data-testid="declutter-no-pickup-slots">{taskId
      ? "None of the seller's pickup times are open before this delivery's deadline."
      : "No pickup times are open before the pickup deadline. Message the seller to agree a time."}</p>{noTimes}</div>;
  }
  const chosenDay = days.find((d) => d.ymd === dayPick) ?? days.find((d) => d.slots.some((s) => s.iso === value)) ?? days[0];
  return (
    <div className="space-y-2" data-testid="declutter-slot-picker">
      <p className="text-xs text-muted-foreground">{own ? "Your pickup times" : "The seller's pickup times"}: {windowsSummary(q.data?.windows ?? [])}</p>
      <div className="flex flex-wrap gap-2" role="group" aria-label="Pickup day">
        {days.map((d) => (
          <Chip key={d.ymd} on={d.ymd === chosenDay.ymd} onClick={() => { setDayPick(d.ymd); onPick(null); }}>{d.label}</Chip>
        ))}
      </div>
      <div className="flex flex-wrap gap-2" role="group" aria-label={`Pickup time on ${chosenDay.label}`}>
        {chosenDay.slots.map((s) => (
          <Chip key={s.iso} on={s.iso === value} onClick={() => onPick(s.iso)}>{s.label}{current && Date.parse(s.iso) === Date.parse(current) ? " (now)" : ""}</Chip>
        ))}
      </div>
    </div>
  );
}

/** `<input type="datetime-local">` value -> ISO (the device's own time zone). */
function localInputToIso(v: string): string | null {
  if (!v) return null;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

/**
 * The Helpr's "Accept delivery" time (lead 2026-10-28): the buyer's day + time chips over the seller's windows for
 * this OPEN delivery (helpr_task_pickup_windows, 20261028232930), so every time offered is one helpr_task_accept
 * takes. Before that read is deployed, the old free field. `onPick` gets the ISO start (null while none is chosen).
 */
export function TaskPickupTime({ taskId, by, value, onPick, enabled = true }: { taskId: string; by: string; value: string | null; onPick: (iso: string | null) => void; enabled?: boolean }) {
  const [free, setFree] = useState("");
  const id = `helpr-slot-${taskId}`;
  // Audit 1c D3-2: already going to this seller? Offer that time first, so it is one visit. A failed read only hides the offer.
  const same = useQuery({ queryKey: ["helpr-tasks", "same-pickup-slot", taskId], queryFn: () => fetchSamePickupSlot(taskId), enabled });
  return (
    <div className="space-y-2">
      {same.data && (
        <div className="space-y-1" data-testid="helpr-same-pickup-slot">
          <p className="text-ds-13 font-semibold">You're already picking up from this seller</p>
          <Chip on={value === same.data} onClick={() => onPick(same.data)}>
            Same time: {new Date(same.data).toLocaleString([], { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}
          </Chip>
        </div>
      )}
      <PickupSlotPicker taskId={taskId} value={value} onPick={onPick} enabled={enabled} fallback={<>
        <label htmlFor={id} className="block text-ds-13 font-semibold">Pickup time (inside the seller's pickup times, by {by})</label>
        <DateTimeField id={id} label="Pickup time" value={free} onChange={(v) => { setFree(v); onPick(localInputToIso(v)); }} />
      </>} />
    </div>
  );
}
