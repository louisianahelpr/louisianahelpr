/**
 * Delivery live map, the seller's and the buyer's side (owner 11-01 11:53 AM; 20261101184555). The seller sees the
 * Helpr coming for the pickup (after the Helpr taps Start, until Picked up); the buyer sees the Helpr from Picked up
 * until delivered, with an ETA. The server decides who may read the position (RLS on helpr_task_live_positions): this
 * component only asks every POLL_MS while the delivery is in that phase, and shows nothing when there has been no row
 * (the Helpr has not tapped Start). A row that goes away after one was seen (Stop, Apple Maps in front, or older than
 * 2 minutes) leaves the last fix on the map with "location paused · last seen N min ago" (A3-61).
 *
 * The map is TrackingMap (the job tracker's Apple map: the Helpr pin and the destination pin), lazy-loaded.
 */
import { lazy, Suspense, useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { fetchLivePosition, type LivePosition } from "@/lib/helprTasks/api";

const TrackingMap = lazy(() => import("@/components/TrackingMap").then((m) => ({ default: m.TrackingMap })));

// At the app-wide poll floor (src/test/hotQueryLoad.test.ts, 15 s); the live row stays readable for 2 minutes.
const POLL_MS = 15_000;

/** "about 12 min away" (the server's rough ETA: road miles at 30 mph, straight to this stop). */
export function etaWords(minutes: number): string {
  if (minutes <= 1) return "almost there";
  if (minutes < 60) return `about ${minutes} min away`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `about ${h} h${m ? ` ${m} min` : ""} away`;
}

/** A3-61: "Yusef's location paused · last seen 3 min ago". */
export function pausedWords(who: string, lastAt: string, now: number): string {
  const min = Math.max(1, Math.round((now - Date.parse(lastAt)) / 60_000));
  return `${who}'s location paused · last seen ${min} min ago`;
}

export function DeliveryLiveMap({ taskId, side, status, who }: { taskId: string; side: "buyer" | "seller"; status: string; who: string }) {
  // The seller's phase is accepted (until Picked up), the buyer's is picked_up (until delivered).
  const live = (side === "seller" && status === "accepted") || (side === "buyer" && status === "picked_up");
  const pos = useQuery({
    queryKey: ["helpr-tasks", "live-position", taskId],
    queryFn: () => fetchLivePosition(taskId),
    enabled: live,
    refetchInterval: live ? POLL_MS : false,
    // A live position: never written to the on-device query cache.
    meta: { persist: false },
  });
  // A3-61: when the Helpr opens Apple Maps to drive, the app stops sending and the row goes after 2 minutes. The panel
  // stays with the last fix and says the location is paused, instead of vanishing without a word.
  const [last, setLast] = useState<LivePosition | null>(null);
  useEffect(() => { if (pos.data) setLast(pos.data); }, [pos.data]);
  const p = pos.data ?? last;
  if (!live || !p) return null;
  const paused = !pos.data;
  const line = paused
    ? pausedWords(who, p.updated_at, pos.dataUpdatedAt || Date.now())
    : side === "seller"
      ? `${who} is on the way to pick it up, ${etaWords(p.eta_minutes)}.`
      : `${who} is on the way with your item, ${etaWords(p.eta_minutes)}.`;
  return (
    <section className="space-y-2" aria-label={`Where ${who} is now`}>
      <p className="text-ds-15 font-semibold" aria-live="polite">{line}</p>
      {paused && <p className="text-ds-13 text-muted-foreground">When last seen, {etaWords(p.eta_minutes)}. It comes back when {who} opens Louisiana Helpr again.</p>}
      <Suspense fallback={<div className="h-[180px] w-full rounded-2xl bg-muted" aria-hidden />}>
        <TrackingMap helperLat={p.lat} helperLng={p.lng} destLat={p.dest_lat} destLng={p.dest_lng} />
      </Suspense>
      <p className="text-ds-12 text-muted-foreground">
        {side === "seller" ? "Shown until it's picked up." : "Shown until it's delivered."} If {who} has other stops first, it may take longer.
      </p>
    </section>
  );
}
