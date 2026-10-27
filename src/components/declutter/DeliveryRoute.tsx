/**
 * "My route" on Deliver for pay (owner request 2026-10-27, multi-stop Declutter delivery: "how they
 * can see what they need to get, like routes, pick up and drop off"). Every stop of the Helpr's
 * deliveries in hand, in the order helpr_my_route plans (each item picked up before it is dropped
 * off, booked pickup times kept), with what to do at each stop, the in-app map (DeliveryRouteMap:
 * numbered pins, the driving line, the next turn) and Open in Maps for voice turn-by-turn.
 *
 * Addresses follow helpr_task_view's rule: the pickup once the delivery is theirs, the drop-off only
 * after the "Picked up" photo. No pay or fee figure is shown here (members never see fee numbers).
 */
import { lazy, Suspense } from "react";
import { useQuery } from "@tanstack/react-query";
import { Navigation } from "lucide-react";
import { ErrorState } from "@/components/ui/ErrorState";
import { declutterErrorMessage } from "@/lib/declutter/errors";
import { photoPublicUrl } from "@/lib/declutter/api";
import { routeMapsUrl } from "@/lib/declutter/route";
import { fetchMyRoute, type RouteStop } from "@/lib/helprTasks/api";
import { StopActions } from "./StopActions";

const DeliveryRouteMap = lazy(() => import("./DeliveryRouteMap"));

const day = (iso: string) => new Date(iso).toLocaleDateString([], { weekday: "short", month: "short", day: "numeric" });
const clock = (iso: string) => new Date(iso).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });

const PLACE_WORDS = {
  pickup: { porch: "On the seller's porch", door: "At the seller's door" },
  dropoff: { porch: "Leave it at the buyer's door", door: "Leave it at the buyer's door" },
} as const;

function StopCard({ stop, userId }: { stop: RouteStop; userId: string }) {
  const pickup = stop.kind === "pickup";
  return (
    <li className="rounded-2xl border border-border bg-card p-4 space-y-3">
      <div className="flex items-start gap-3">
        <span aria-hidden className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-ds-14 font-bold ${pickup ? "bg-primary text-primary-foreground" : "bg-[hsl(var(--burnt-sienna))] text-white"}`}>
          {stop.seq}
        </span>
        <div className="min-w-0 space-y-0.5">
          <p className="text-ds-12 font-semibold uppercase tracking-wide text-muted-foreground">{pickup ? "Pick up" : "Drop off"}</p>
          <p className="text-ds-15 font-semibold leading-snug line-clamp-2" title={stop.title}>{stop.title}</p>
          <p className="text-ds-13 break-words">
            {stop.address
              ? <span className="font-medium">{stop.address}</span>
              : <span className="text-muted-foreground">Near {stop.area}. The address shows once you've picked the item up.</span>}
          </p>
          <p className="text-ds-13 text-muted-foreground">{PLACE_WORDS[stop.kind][stop.place]}</p>
        </div>
      </div>
      <p className="text-ds-13">
        {pickup && stop.slot_start && stop.slot_end
          ? <>Pick up {day(stop.slot_start)}, {clock(stop.slot_start)} to {clock(stop.slot_end)}</>
          : <>Drop off about {clock(stop.arrive_at)}, any time after the pickup</>}
        {stop.leg_miles > 0 && <span className="text-muted-foreground"> · about {stop.leg_miles} mi from {stop.seq === 1 ? "you" : "the last stop"}</span>}
      </p>
      {stop.late && <p className="text-ds-13 font-semibold text-destructive" role="status">You may be late for this pickup time.</p>}
      {stop.items.length > 0 && (
        <ul className="flex flex-wrap gap-3" aria-label="Items">
          {stop.items.map((it, i) => (
            <li key={`${it.title}-${i}`} className="w-20 space-y-1">
              {it.photo_path
                ? <img src={photoPublicUrl(it.photo_path)} alt={it.title} className="h-20 w-20 rounded-lg bg-photo-empty object-cover" loading="lazy" />
                : <span aria-hidden className="block h-20 w-20 rounded-lg bg-photo-empty" />}
              <p className="text-ds-12 line-clamp-2">{it.title}</p>
            </li>
          ))}
        </ul>
      )}
      <StopActions stop={stop} userId={userId} />
    </li>
  );
}

/** The route section: summary, Open in Maps, the in-app map, and every stop in order. */
export function DeliveryRoute({ userId, where }: { userId: string; where: { lat: number; lng: number } | null }) {
  const route = useQuery({
    queryKey: ["helpr-tasks", "route", where?.lat ?? null, where?.lng ?? null],
    // Exact addresses and the Helpr's position: never written to the on-device query cache.
    meta: { persist: false },
    queryFn: () => fetchMyRoute(where),
  });
  if (route.isError) {
    return <ErrorState variant="inline" title="We couldn't load your route." body={declutterErrorMessage(route.error)} onRetry={() => void route.refetch()} />;
  }
  if (route.isLoading || !route.data) return <p className="text-sm text-muted-foreground" role="status">Loading your route…</p>;
  const { stops, miles, drive_minutes } = route.data;
  if (stops.length === 0) return null;
  const maps = routeMapsUrl(stops);
  return (
    <section className="space-y-3" aria-label="Your route">
      <div className="space-y-1">
        <h2 className="text-base font-semibold">Your route</h2>
        <p className="text-ds-13 text-muted-foreground">
          {stops.length} {stops.length === 1 ? "stop" : "stops"} · about {Math.max(1, Math.round(miles))} mi · about {drive_minutes} min of driving and stops
        </p>
      </div>
      <Suspense fallback={<div className="h-64 w-full rounded-2xl bg-muted" aria-hidden />}>
        <DeliveryRouteMap stops={stops} userId={userId} />
      </Suspense>
      {maps && (
        <div className="space-y-1">
          <a href={maps.href} target="_blank" rel="noopener noreferrer"
            className="inline-flex min-h-11 items-center gap-2 rounded-full border border-border px-4 py-2 text-sm font-semibold">
            <Navigation className="h-4 w-4" aria-hidden />
            Open in Maps
          </a>
          <p className="text-ds-12 text-muted-foreground">
            For spoken turn-by-turn. {maps.left_out > 0
              ? `Opens the next ${maps.count} ${maps.count === 1 ? "stop" : "stops"}; a drop-off joins once you've picked its item up.`
              : `Opens all ${maps.count} ${maps.count === 1 ? "stop" : "stops"} in this order.`}
          </p>
        </div>
      )}
      <ol className="space-y-3" aria-label="Stops in order">
        {stops.map((s) => <StopCard key={`${s.task_id}:${s.kind}`} stop={s} userId={userId} />)}
      </ol>
    </section>
  );
}
