/** "Picked up" / "Left at the door" for one stop of My route (the list and the map's current stop). */
import { useId, useRef, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import type { RouteStop } from "@/lib/helprTasks/api";
import { fetchTaskView, reportPickupNoShow, uploadTaskPhoto } from "@/lib/helprTasks/api";
import { declutterErrorMessage } from "@/lib/declutter/errors";
import { currentPosition } from "@/lib/declutter/position";
import { useTaskSteps } from "./useTaskSteps";
import { ConfirmSheet } from "./DeclutterConfirmSheet";
import { PhotoPickButton } from "@/components/ui/PhotoPickButton";
import { HelprCantFinish } from "./DeliveryCantFinish";

const primary = "btn-grad-primary rounded-full px-4 py-2 text-sm font-semibold";
const clock = (iso: string) => new Date(iso).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
const day = (iso: string) => new Date(iso).toLocaleDateString([], { weekday: "short", month: "short", day: "numeric" });

/** helpr_task_picked_up's window (20261030012018): from 30 minutes before the booked pickup. */
const PICKUP_OPENS_MIN_BEFORE = 30;
/** helpr_task_pickup_no_show's: from 15 minutes after the booked pickup. */
const SELLER_AWAY_MIN_AFTER = 15;

/** When "Picked up" opens for a booked pickup, or null if it is open now. */
function pickupOpensAt(slotStart: string | null | undefined, now = Date.now()): string | null {
  if (!slotStart) return null;
  const opens = new Date(slotStart).getTime() - PICKUP_OPENS_MIN_BEFORE * 60_000;
  return now < opens ? new Date(opens).toISOString() : null;
}

/** "You can mark it picked up from Sat, Oct 31, 8:30 AM, or once the seller taps Handed over." */
function PickupWindowNote({ opensAt }: { opensAt: string }) {
  return (
    <p className="text-ds-13 text-muted-foreground" data-pickup-opens="">
      You can mark it picked up from {day(opensAt)}, {clock(opensAt)}, or once the seller taps Handed over.
    </p>
  );
}

/**
 * "The seller wasn't there" (helpr_task_pickup_no_show): from 15 minutes after the booked pickup, a photo of the
 * door taken at the pickup address, asked in the app. Shared by the delivery card and My route's pickup stop
 * (audit 1c #4: the route stop never offered it).
 */
function SellerAwayStep({ taskId, userId, slotStart, label, onReported }: {
  taskId: string;
  userId: string;
  slotStart: string | null;
  label?: string;
  onReported: (msg: string) => void;
}) {
  const id = useId();
  const [file, setFile] = useState<File | null>(null);
  const uploaded = useRef<{ file: File; path: string } | null>(null);
  const report = useMutation({
    mutationFn: async (f: File) => {
      // Location first (a refusal uploads nothing), then the photo once per file.
      const where = await currentPosition();
      if (uploaded.current?.file !== f) uploaded.current = { file: f, path: await uploadTaskPhoto(userId, taskId, f) };
      await reportPickupNoShow(taskId, uploaded.current.path, where);
    },
    onSettled: () => setFile(null),
    onSuccess: () => onReported("Reported. Louisiana Helpr will look at it and decide. You're not counted as a no-show meanwhile."),
    onError: (err) => toast.error(declutterErrorMessage(err)),
  });
  if (!slotStart || Date.now() < new Date(slotStart).getTime() + SELLER_AWAY_MIN_AFTER * 60_000) return null;
  return (
    <>
      <label htmlFor={`${id}-away`} className="block text-xs font-medium">
        The seller wasn't there: a photo of the door, taken at the pickup address{label ? <span className="sr-only"> ({label})</span> : null}
      </label>
      <PhotoPickButton id={`${id}-away`} disabled={report.isPending} onPick={setFile} />
      <ConfirmSheet open={file !== null} title="Report that the seller wasn't there?" confirmLabel="Report it" pending={report.isPending}
        onConfirm={() => { if (file) report.mutate(file); }} onClose={() => setFile(null)} testId="delivery-seller-away">
        Your door photo goes to Louisiana Helpr, who looks at it and decides. You're not counted as a no-show meanwhile.
      </ConfirmSheet>
    </>
  );
}

/** What the Helpr does at a stop: the "Picked up" photo, or the drop-off photo and "Left at the door". */
export function StopActions({ stop, userId }: { stop: RouteStop; userId: string }) {
  const [dropPhoto, setDropPhoto] = useState<File | null>(null);
  // BUY-40: "Picked up" fired the moment a photo was chosen. Like the drop-off, the photo is picked (shown, can be
  // retaken), then sent with its own button.
  const [pickPhoto, setPickPhoto] = useState<File | null>(null);
  const { pickedUp, delivered, done } = useTaskSteps(stop.task_id, userId, () => setDropPhoto(null));
  const id = useId();
  // BUY-36: reported as can't finish: the drop-off waits (the server refuses it: delivery_on_hold), except the one retry.
  const view = useQuery({ queryKey: ["helpr-tasks", "view", stop.task_id], queryFn: () => fetchTaskView(stop.task_id), enabled: stop.kind !== "pickup" && stop.status === "picked_up", meta: { persist: false } });
  const onHold = !!view.data?.stuck_stage && view.data.stuck_stage !== "retrying";
  if (stop.kind === "pickup") {
    // Audit 1c #1: Picked up opens 30 minutes before the pickup, or at once after the seller's "Handed over". Only a server
    // that says "not handed over" (null) can close the button; before that migration the server's own refusal answers.
    const opensAt = stop.handed_over_at ? null : pickupOpensAt(stop.slot_start);
    return (
      <div className="space-y-1">
        <label htmlFor={`${id}-pick`} className="block text-ds-13 font-semibold">Picked up: a photo of the item, taken here<span className="sr-only"> ({stop.title}, stop {stop.seq})</span></label>
        {opensAt && <PickupWindowNote opensAt={opensAt} />}
        <PhotoPickButton id={`${id}-pick`} picked={pickPhoto} disabled={pickedUp.isPending || (opensAt !== null && stop.handed_over_at === null)} onPick={setPickPhoto} />
        {pickPhoto && (
          <button type="button" className={`${primary} disabled:opacity-50`} disabled={pickedUp.isPending} onClick={() => pickedUp.mutate(pickPhoto)}>
            Picked up
          </button>
        )}
        <SellerAwayStep taskId={stop.task_id} userId={userId} slotStart={stop.slot_start} label={`${stop.title}, stop ${stop.seq}`} onReported={done} />
      </div>
    );
  }
  if (stop.status !== "picked_up") return <p className="text-ds-13 text-muted-foreground">Pick this item up first.</p>;
  if (onHold) return <HelprCantFinish taskId={stop.task_id} userId={userId} />;
  return (
    <div className="space-y-2">
      {/* Deep audit #41: on a route every stop had the same label; the hidden words tell a screen reader which stop. */}
      <label htmlFor={`${id}-drop`} className="block text-ds-13 font-semibold">Photo at the drop-off address<span className="sr-only"> ({stop.title}, stop {stop.seq})</span></label>
      <PhotoPickButton id={`${id}-drop`} picked={dropPhoto} onPick={setDropPhoto} />
      <button type="button" className={`${primary} disabled:opacity-50`} disabled={delivered.isPending || !dropPhoto} onClick={() => delivered.mutate(dropPhoto)}>
        Left at the door
      </button>
      <HelprCantFinish taskId={stop.task_id} userId={userId} />
    </div>
  );
}
