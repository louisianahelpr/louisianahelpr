/**
 * Declutter slice 5 screens, Helpr delivery (docs/specs/declutter-auctions.md
 * rows 24, 29-30, 40-43; B59-B72):
 *   - OrderDeliveryPanel: the buyer's and the seller's view of a paid delivery
 *     order (waiting for a Helpr, the pickup time, on its way, at the door), the
 *     buyer's 4-digit drop-off code and "I got it", the photos from both ends;
 *   - DeliverView (/declutter?view=deliver): a Helpr's vehicle (row 41), the
 *     deliveries near them they can take with a pickup time, and their own
 *     deliveries: the exact addresses, "Picked up" photo at the pickup, the
 *     drop-off with the buyer's code or a door photo, backing out, "The seller
 *     wasn't there", and their pay.
 * Built on the shared Helpr task module (src/lib/helprTasks/api.ts); every rule
 * is enforced in SQL (20261016053945), these screens only explain it.
 */
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { ErrorState } from "@/components/ui/ErrorState";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { declutterErrorMessage } from "@/lib/declutter/errors";
import { formatPrice } from "@/lib/declutter/distance";
import { currentPosition } from "@/lib/declutter/position";
import {
  acceptTask,
  confirmReceived,
  fetchMyTasks,
  fetchMyVehicle,
  fetchOpenTasks,
  fetchTaskView,
  markDelivered,
  markPickedUp,
  releaseTask,
  reportPickupNoShow,
  saveVehicle,
  taskPhotoUrl,
  uploadTaskPhoto,
  uploadVehiclePhoto,
  type MyTask,
  type OpenTask,
  type TaskSize,
  type TaskView,
} from "@/lib/helprTasks/api";

const btn = "rounded-full border border-border px-4 py-2 text-sm font-semibold";
const primary = "btn-grad-primary rounded-full px-4 py-2 text-sm font-semibold";
const input = "w-full min-w-0 rounded-lg border border-input bg-background px-3 py-2 text-sm";

const SIZE_WORDS: Record<TaskSize, string> = {
  small: "Small (fits in a car)",
  large: "Large (needs a truck)",
  xl: "Extra large (truck and two people)",
};

const when = (iso: string) => new Date(iso).toLocaleString([], { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });

/** `<input type="datetime-local">` value -> ISO (the device's own time zone). */
function localInputToIso(v: string): string | null {
  if (!v) return null;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

function invalidateTasks(qc: ReturnType<typeof useQueryClient>) {
  void qc.invalidateQueries({ queryKey: ["helpr-tasks"] });
  void qc.invalidateQueries({ queryKey: ["declutter", "my-cart"] });
}

/** A private task photo through a short-lived signed URL. */
function TaskPhoto({ path, label }: { path: string; label: string }) {
  const url = useQuery({ queryKey: ["helpr-tasks", "photo", path], queryFn: () => taskPhotoUrl(path), staleTime: 5 * 60_000 });
  if (!url.data) return null;
  return (
    <figure className="space-y-1">
      <img src={url.data} alt={label} className="h-32 w-32 rounded-lg object-cover" loading="lazy" />
      <figcaption className="text-xs text-muted-foreground">{label}</figcaption>
    </figure>
  );
}

function TaskPhotos({ view }: { view: TaskView }) {
  if (!view.pickup_photo_path && !view.dropoff_photo_path) return null;
  return (
    <div className="flex flex-wrap gap-3">
      {view.pickup_photo_path && <TaskPhoto path={view.pickup_photo_path} label="At the pickup" />}
      {view.dropoff_photo_path && <TaskPhoto path={view.dropoff_photo_path} label="At the drop-off" />}
    </div>
  );
}

/** What the buyer or the seller reads about a paid delivery order. */
export function OrderDeliveryPanel({ taskId, side, orderId }: { taskId: string; side: "buyer" | "seller"; orderId: string }) {
  const qc = useQueryClient();
  const task = useQuery({ queryKey: ["helpr-tasks", "view", taskId], queryFn: () => fetchTaskView(taskId) });
  const gotIt = useMutation({
    mutationFn: () => confirmReceived(taskId),
    onSuccess: () => {
      toast.success("Delivery done. Enjoy your item.");
      invalidateTasks(qc);
      void qc.invalidateQueries({ queryKey: ["declutter", "handover", orderId] });
    },
    onError: (err) => toast.error(declutterErrorMessage(err)),
  });
  if (task.isError) {
    return <ErrorState variant="inline" title="We couldn't load this delivery." body={declutterErrorMessage(task.error)} onRetry={() => void task.refetch()} />;
  }
  if (task.isLoading || !task.data) return <p className="text-sm text-muted-foreground" role="status">Loading the delivery…</p>;
  const v = task.data;
  const who = v.helpr_first_name ?? "Your Helpr";
  let line: string;
  if (v.status === "open") {
    line = side === "buyer"
      ? `Finding a Helpr. If nobody takes it by ${when(v.open_until)}, your delivery fee comes back and you pick it up at the seller's home instead.`
      : "Finding a Helpr. You'll be told the pickup time.";
  } else if (v.status === "accepted" && v.pickup_slot_start) {
    line = side === "buyer"
      ? `${who} picks it up from the seller ${when(v.pickup_slot_start)}.`
      : `${who} picks it up ${when(v.pickup_slot_start)}. Have it ready.`;
  } else if (v.status === "picked_up") {
    line = side === "buyer" ? `${who} has your item and is on the way.` : `${who} picked it up. You're paid when the buyer has it.`;
  } else if (v.status === "delivered" && v.delivered_at) {
    line = side === "buyer"
      ? `${who} left it at your drop-off address ${when(v.delivered_at)}. Tap "I got it". If something is wrong, report a problem before it confirms itself ${when(new Date(new Date(v.delivered_at).getTime() + 24 * 3_600_000).toISOString())}.`
      : `${who} left it at the buyer's address. You're paid when the buyer confirms, or after 24 hours.`;
  } else if (v.status === "confirmed") {
    line = "Delivered.";
  } else if (v.status === "unfilled") {
    line = "No Helpr took this delivery. The delivery fee was refunded.";
  } else {
    line = "This delivery was closed.";
  }
  const canConfirm = side === "buyer" && (v.status === "picked_up" || v.status === "delivered");
  return (
    <div className="space-y-2">
      <p className="text-sm">{line}</p>
      <p className="text-xs text-muted-foreground">To {v.dropoff_area} · {SIZE_WORDS[v.size]}</p>
      {side === "buyer" && v.dropoff_code && (
        <p className="text-sm">
          Your drop-off code: <span className="font-mono text-2xl font-bold tracking-widest" aria-hidden="true">{v.dropoff_code}</span>
          <span className="sr-only">{v.dropoff_code.split("").join(" ")}</span>
          <span className="block text-xs text-muted-foreground">Give it to the Helpr when you have the item. Never share it before.</span>
        </p>
      )}
      <TaskPhotos view={v} />
      {canConfirm && (
        <button type="button" className={primary} disabled={gotIt.isPending}
          onClick={() => { if (window.confirm("Do you have the item? Tapping \"I got it\" pays the seller and the Helpr and makes the sale final.")) gotIt.mutate(); }}>
          I got it
        </button>
      )}
    </div>
  );
}

/** Row 41: "I have a truck" (+ "I can bring a second person") with a vehicle photo. */
function VehicleForm({ userId }: { userId: string }) {
  const qc = useQueryClient();
  const vehicle = useQuery({ queryKey: ["helpr-tasks", "vehicle", userId], queryFn: () => fetchMyVehicle(userId) });
  const [truck, setTruck] = useState<boolean | null>(null);
  const [second, setSecond] = useState<boolean | null>(null);
  const [photo, setPhoto] = useState<File | null>(null);
  const hasTruck = truck ?? vehicle.data?.has_truck ?? false;
  const twoPeople = hasTruck && (second ?? vehicle.data?.second_person ?? false);
  const save = useMutation({
    mutationFn: async () => {
      const path = hasTruck ? (photo ? await uploadVehiclePhoto(userId, photo) : vehicle.data?.photo_path ?? null) : null;
      await saveVehicle(hasTruck, twoPeople, path);
    },
    onSuccess: () => {
      toast.success("Saved.");
      setPhoto(null);
      void qc.invalidateQueries({ queryKey: ["helpr-tasks"] });
    },
    onError: (err) => toast.error(declutterErrorMessage(err)),
  });
  if (vehicle.isError) {
    return <ErrorState variant="inline" title="We couldn't load your vehicle." body={declutterErrorMessage(vehicle.error)} onRetry={() => void vehicle.refetch()} />;
  }
  const photoId = `helpr-vehicle-photo-${userId}`;
  return (
    <section className="rounded-2xl border border-border bg-card p-4 space-y-2" aria-label="Your vehicle">
      <h2 className="text-base font-semibold">Your vehicle</h2>
      <p className="text-sm text-muted-foreground">Small items fit in any car. Large and extra large items need a truck.</p>
      <label className="flex items-center gap-2 text-sm min-h-11">
        <input type="checkbox" checked={hasTruck} onChange={(e) => setTruck(e.target.checked)} style={{ accentColor: "hsl(var(--primary))" }} />
        I have a truck
      </label>
      {hasTruck && (
        <>
          <label className="flex items-center gap-2 text-sm min-h-11">
            <input type="checkbox" checked={twoPeople} onChange={(e) => setSecond(e.target.checked)} style={{ accentColor: "hsl(var(--primary))" }} />
            I can bring a second person (for extra large items)
          </label>
          <label htmlFor={photoId} className="block text-xs font-medium">
            {vehicle.data?.photo_path ? "Truck photo saved. Add a new one to replace it." : "Photo of your truck"}
          </label>
          <input id={photoId} type="file" accept="image/*" capture="environment" onChange={(e) => setPhoto(e.target.files?.[0] ?? null)} />
        </>
      )}
      <button type="button" className={primary}
        disabled={save.isPending || (hasTruck && !photo && !vehicle.data?.photo_path)} onClick={() => save.mutate()}>
        {save.isPending ? "Saving…" : "Save"}
      </button>
    </section>
  );
}

/** One open delivery a Helpr can take: pick a pickup time inside the seller's times. */
function OpenTaskRow({ t }: { t: OpenTask }) {
  const qc = useQueryClient();
  const [slot, setSlot] = useState("");
  const take = useMutation({
    mutationFn: (iso: string) => acceptTask(t.task_id, iso),
    onSuccess: () => { toast.success("It's yours. The seller and the buyer are told your pickup time."); setSlot(""); invalidateTasks(qc); },
    onError: (err) => toast.error(declutterErrorMessage(err)),
  });
  const id = `helpr-slot-${t.task_id}`;
  return (
    <li className="rounded-2xl border border-border bg-card p-4 space-y-2">
      <p className="font-semibold truncate" title={t.title}>{t.title}</p>
      <p className="text-sm">{t.pickup_area} to {t.dropoff_area} · about {t.trip_miles} {t.trip_miles === 1 ? "mile" : "miles"}</p>
      <p className="text-sm text-muted-foreground">
        {SIZE_WORDS[t.size]}{t.miles_to_pickup !== null ? ` · pickup about ${t.miles_to_pickup} ${t.miles_to_pickup === 1 ? "mile" : "miles"} from you` : ""}
      </p>
      <p className="text-sm font-medium">You get {formatPrice(t.take_home_cents)} <span className="font-normal text-muted-foreground">(after the 5% + 70¢ fee)</span></p>
      <label htmlFor={id} className="block text-xs font-medium">Pickup time (inside the seller's pickup times, by {when(t.latest_pickup_at)})</label>
      <div className="flex gap-2">
        <input id={id} type="datetime-local" className={`${input} min-w-0`} value={slot} onChange={(e) => setSlot(e.target.value)} />
        <button type="button" className={`${primary} shrink-0`} disabled={take.isPending || !localInputToIso(slot)}
          onClick={() => { const iso = localInputToIso(slot); if (iso) take.mutate(iso); }}>
          Take it
        </button>
      </div>
    </li>
  );
}

/** One delivery the Helpr took: the addresses and every step. */
function MyTaskCard({ t, userId }: { t: MyTask; userId: string }) {
  const qc = useQueryClient();
  const active = t.status === "accepted" || t.status === "picked_up" || t.status === "delivered";
  const view = useQuery({ queryKey: ["helpr-tasks", "view", t.task_id], queryFn: () => fetchTaskView(t.task_id), enabled: active });
  const [dropPhoto, setDropPhoto] = useState<File | null>(null);
  const [code, setCode] = useState("");
  const done = (msg: string) => { toast.success(msg); invalidateTasks(qc); };
  const pickedUp = useMutation({
    mutationFn: async (file: File) => {
      const path = await uploadTaskPhoto(userId, t.task_id, file);
      await markPickedUp(t.task_id, path, await currentPosition());
    },
    onSuccess: () => done("Picked up. The buyer is told it's on the way."),
    onError: (err) => toast.error(declutterErrorMessage(err)),
  });
  const deliver = useMutation({
    mutationFn: async () => {
      const path = dropPhoto ? await uploadTaskPhoto(userId, t.task_id, dropPhoto) : null;
      const where = path ? await currentPosition() : null;
      return markDelivered(t.task_id, path, where, code.length === 4 ? code : null);
    },
    onSuccess: (r) => {
      setCode("");
      if (r.result === "wrong_code") { toast.error(`That code isn't right. ${r.attempts_left} ${r.attempts_left === 1 ? "try" : "tries"} left.`); return; }
      if (r.result === "code_locked") { toast.error("Too many wrong codes. Leave it with a photo, and the buyer taps \"I got it\"."); return; }
      setDropPhoto(null);
      done(r.result === "delivered"
        ? r.held
          ? "Left at the door. A problem was reported on this sale, so your pay waits until Louisiana Helpr decides."
          : "Left at the door. You're paid when the buyer confirms, or after 24 hours."
        : "Delivered. You're being paid.");
    },
    onError: (err) => toast.error(declutterErrorMessage(err)),
  });
  const backOut = useMutation({
    mutationFn: () => releaseTask(t.task_id),
    onSuccess: (r) => done(r.strike ? "You backed out less than 2 hours before the pickup, so you got a delivery strike." : "You backed out. Another Helpr can take it."),
    onError: (err) => toast.error(declutterErrorMessage(err)),
  });
  const sellerAway = useMutation({
    mutationFn: async (file: File) => {
      const path = await uploadTaskPhoto(userId, t.task_id, file);
      await reportPickupNoShow(t.task_id, path, await currentPosition());
    },
    onSuccess: () => done("Reported. Louisiana Helpr will look at it and decide. You're not counted as a no-show meanwhile."),
    onError: (err) => toast.error(declutterErrorMessage(err)),
  });
  const v = view.data;
  const pickId = `helpr-pick-${t.task_id}`;
  const dropId = `helpr-drop-${t.task_id}`;
  const codeId = `helpr-code-${t.task_id}`;
  const awayId = `helpr-away-${t.task_id}`;
  return (
    <li className="rounded-2xl border border-border bg-card p-4 space-y-2">
      <p className="font-semibold truncate" title={t.title}>{t.title}</p>
      <p className="text-sm text-muted-foreground">{SIZE_WORDS[t.size]} · {formatPrice(t.take_home_cents)} for you</p>
      {!active && (
        <p className="text-sm">
          {t.status === "confirmed"
            ? t.payout_status === "succeeded" ? "Delivered and paid." : "Delivered. Your pay is on its way."
            : t.status === "failed" ? "Decided as damaged in delivery. Not paid." : "Closed."}
        </p>
      )}
      {active && view.isError && <p className="text-sm" role="alert">{declutterErrorMessage(view.error)}</p>}
      {active && v && (
        <>
          {v.pickup_slot_start && <p className="text-sm">Pickup: <span className="font-medium">{when(v.pickup_slot_start)}</span></p>}
          {v.pickup_address && <p className="text-sm">Pick up at: <span className="font-medium">{v.pickup_address}</span></p>}
          {v.dropoff_address && <p className="text-sm">Deliver to: <span className="font-medium">{v.dropoff_address}</span></p>}
          {v.status === "accepted" && (
            <>
              <label htmlFor={pickId} className="block text-xs font-medium">Photo of the item when you pick it up, taken at the pickup address</label>
              <input id={pickId} type="file" accept="image/*" capture="environment" disabled={pickedUp.isPending}
                onChange={(e) => { const f = e.target.files?.[0]; if (f) pickedUp.mutate(f); e.target.value = ""; }} />
              <div className="flex flex-wrap gap-2">
                <button type="button" className={btn} disabled={backOut.isPending}
                  onClick={() => { if (window.confirm("Back out of this delivery? Under 2 hours before the pickup it costs a delivery strike.")) backOut.mutate(); }}>
                  Back out
                </button>
              </div>
              {v.pickup_slot_start && Date.now() >= new Date(v.pickup_slot_start).getTime() + 15 * 60_000 && (
                <>
                  <label htmlFor={awayId} className="block text-xs font-medium">
                    The seller wasn't there: a photo of the door, taken at the pickup address
                  </label>
                  <input id={awayId} type="file" accept="image/*" capture="environment" disabled={sellerAway.isPending}
                    onChange={(e) => {
                      const f = e.target.files?.[0];
                      e.target.value = "";
                      if (f && window.confirm("Report that the seller wasn't there? Louisiana Helpr looks at it and decides.")) sellerAway.mutate(f);
                    }} />
                </>
              )}
            </>
          )}
          {(v.status === "picked_up" || v.status === "delivered") && (
            <div className="space-y-2 rounded-xl border border-border p-3">
              {v.status === "picked_up" && (
                <>
                  <label htmlFor={dropId} className="block text-xs font-medium">Photo at the drop-off address</label>
                  <input id={dropId} type="file" accept="image/*" capture="environment" onChange={(e) => setDropPhoto(e.target.files?.[0] ?? null)} />
                </>
              )}
              <label htmlFor={codeId} className="block text-xs font-medium">The buyer's 4-digit code (leave empty if nobody is home)</label>
              {v.code_locked ? (
                <p className="text-sm">Too many wrong codes. Leave it with a photo; the buyer taps "I got it".</p>
              ) : (
                <input id={codeId} inputMode="numeric" autoComplete="off" maxLength={4} className={input} value={code}
                  onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 4))} />
              )}
              <button type="button" className={primary}
                disabled={deliver.isPending || (v.status === "picked_up" && !dropPhoto) || (v.status === "delivered" && code.length !== 4)}
                onClick={() => deliver.mutate()}>
                {v.status === "delivered" ? "Confirm with the code" : code.length === 4 ? "Handed over" : "Left at the door"}
              </button>
            </div>
          )}
          <TaskPhotos view={v} />
        </>
      )}
    </li>
  );
}

/** /declutter?view=deliver: a Helpr's vehicle, deliveries to take, and their own deliveries. */
export function DeliverView() {
  const { user } = useCurrentUser();
  const userId = user?.id ?? "";
  const [where, setWhere] = useState<{ lat: number; lng: number } | null>(null);
  const mine = useQuery({ queryKey: ["helpr-tasks", "mine"], queryFn: fetchMyTasks, enabled: !!userId });
  const open = useQuery({ queryKey: ["helpr-tasks", "open", where?.lat ?? null, where?.lng ?? null], queryFn: () => fetchOpenTasks(where), enabled: !!userId });
  const locate = useMutation({
    mutationFn: currentPosition,
    onSuccess: (p) => setWhere(p),
    onError: (err) => toast.error(declutterErrorMessage(err)),
  });
  if (!userId) return null;
  const myList = mine.data ?? [];
  return (
    <div className="space-y-6">
      <p className="text-sm text-muted-foreground">
        Deliver Declutter items near you. You pick the item up at the seller's, take a photo there, and hand it over with the buyer's code or leave it at the door with a photo. You keep the delivery fee minus 5% + 70¢.
      </p>
      <VehicleForm userId={userId} />
      <section className="space-y-3" aria-label="Your deliveries">
        <h2 className="text-base font-semibold">Your deliveries</h2>
        {mine.isError ? (
          <ErrorState variant="inline" title="We couldn't load your deliveries." body={declutterErrorMessage(mine.error)} onRetry={() => void mine.refetch()} />
        ) : mine.isLoading ? (
          <p className="text-sm text-muted-foreground" role="status">Loading your deliveries…</p>
        ) : myList.length === 0 ? (
          <p className="text-sm text-muted-foreground">You haven't taken a delivery yet.</p>
        ) : (
          <ul className="space-y-3">{myList.map((t) => <MyTaskCard key={t.task_id} t={t} userId={userId} />)}</ul>
        )}
      </section>
      <section className="space-y-3" aria-label="Deliveries near you">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-base font-semibold">Deliveries you can take</h2>
          <button type="button" className={btn} disabled={locate.isPending} onClick={() => locate.mutate()}>
            {where ? "Update my location" : "Nearest first"}
          </button>
        </div>
        {open.isError ? (
          <ErrorState variant="inline" title="We couldn't load deliveries." body={declutterErrorMessage(open.error)} onRetry={() => void open.refetch()} />
        ) : open.isLoading ? (
          <p className="text-sm text-muted-foreground" role="status">Loading deliveries…</p>
        ) : (open.data ?? []).length === 0 ? (
          <p className="text-sm text-muted-foreground">No deliveries to take right now. Large items only show once you add a truck.</p>
        ) : (
          <ul className="space-y-3">{(open.data ?? []).map((t) => <OpenTaskRow key={t.task_id} t={t} />)}</ul>
        )}
      </section>
    </div>
  );
}
