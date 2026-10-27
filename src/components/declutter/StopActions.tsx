/** "Picked up" / "Left at the door" for one stop of My route (the list and the map's current stop). */
import { useId, useState } from "react";
import type { RouteStop } from "@/lib/helprTasks/api";
import { useTaskSteps } from "./useTaskSteps";

const primary = "btn-grad-primary rounded-full px-4 py-2 text-sm font-semibold";

/** What the Helpr does at a stop: the "Picked up" photo, or the drop-off photo and "Left at the door". */
export function StopActions({ stop, userId }: { stop: RouteStop; userId: string }) {
  const [dropPhoto, setDropPhoto] = useState<File | null>(null);
  const { pickedUp, delivered } = useTaskSteps(stop.task_id, userId, () => setDropPhoto(null));
  const id = useId();
  if (stop.kind === "pickup") {
    return (
      <div className="space-y-1">
        <label htmlFor={`${id}-pick`} className="block text-ds-13 font-semibold">Picked up: a photo of the item, taken here</label>
        <input id={`${id}-pick`} type="file" accept="image/*" capture="environment" className="block w-full max-w-full text-ds-13" disabled={pickedUp.isPending}
          onChange={(e) => { const f = e.target.files?.[0]; if (f) pickedUp.mutate(f); e.target.value = ""; }} />
      </div>
    );
  }
  if (stop.status !== "picked_up") return <p className="text-ds-13 text-muted-foreground">Pick this item up first.</p>;
  return (
    <div className="space-y-2">
      <label htmlFor={`${id}-drop`} className="block text-ds-13 font-semibold">Photo at the drop-off address</label>
      <input id={`${id}-drop`} type="file" accept="image/*" capture="environment" className="block w-full max-w-full text-ds-13" onChange={(e) => setDropPhoto(e.target.files?.[0] ?? null)} />
      <button type="button" className={`${primary} disabled:opacity-50`} disabled={delivered.isPending || !dropPhoto} onClick={() => delivered.mutate(dropPhoto)}>
        Left at the door
      </button>
    </div>
  );
}
