/**
 * "My route" on Deliver for pay (owner request 2026-10-27, multi-stop Declutter delivery: "how they
 * can see what they need to get, like routes, pick up and drop off"). Every stop of the Helpr's
 * deliveries in hand, in the order helpr_my_route plans (each item picked up before it is dropped
 * off, booked pickup times kept), with what to do at each stop, the in-app map (DeliveryRouteMap:
 * numbered pins, the driving line, the next turn) and Open in Maps for voice turn-by-turn.
 *
 * Addresses follow helpr_task_view's rule: the pickup once the delivery is theirs; the drop-off by
 * helpr_task_dropoff_shows_at (owner 2026-10-27, issue #3684: at once for a Helpr with a finished delivery, else 2 hours
 * before the booked pickup or after Picked up; BUY-38). No pay or fee figure is shown here (members never see fee numbers).
 */
import { lazy, Suspense } from "react";
import { useQuery } from "@tanstack/react-query";
import { Navigation } from "lucide-react";
import { ErrorState } from "@/components/ui/ErrorState";
import { declutterErrorMessage } from "@/lib/declutter/errors";
import { photoPublicUrl } from "@/lib/declutter/api";
import { routeMapsUrl, routeVisits } from "@/lib/declutter/route";
import { fetchMyRoute, type RouteStop } from "@/lib/helprTasks/api";
import { StopActions } from "./StopActions";
import { RouteSuggestions } from "./RouteSuggestions";
import { FallbackImg } from "./FallbackImg";

const DeliveryRouteMap = lazy(() => import("./DeliveryRouteMap"));

const day = (iso: string) => new Date(iso).toLocaleDateString([], { weekday: "short", month: "short", day: "numeric" });
const clock = (iso: string) => new Date(iso).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });

const PLACE_WORDS = {
  // A2-12: the seller never chooses porch or door for a Helpr pickup, so the route says both ("seller").
  pickup: { porch: "On the seller's porch", door: "At the seller's door", seller: "At the seller's door, or on the porch if they leave it out" },
  dropoff: { porch: "Leave it at the buyer's door", door: "Leave it at the buyer's door", seller: "Leave it at the buyer's door" },
} as const;

/** One visit: usually one stop; pickups joined into one visit (D3-2) share the header and keep their own photo step. */
function VisitCard({ visit, userId }: { visit: RouteStop[]; userId: string }) {
  const stop = visit[0];
  const pickup = stop.kind === "pickup";
  return (
    <li className="rounded-2xl border border-border bg-card p-4 space-y-3">
      <div className="flex items-start gap-3">
        <span aria-hidden className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-ds-14 font-bold ${pickup ? "bg-primary text-primary-foreground" : "bg-[hsl(var(--burnt-sienna))] text-white"}`}>
          {stop.seq}
        </span>
        <div className="min-w-0 space-y-0.5">
          <p className="text-ds-12 font-semibold uppercase tracking-wide text-muted-foreground">
            {pickup ? (visit.length > 1 ? `Pick up ${visit.length} deliveries here` : "Pick up") : "Drop off"}
          </p>
          {visit.length === 1 && <p className="text-ds-15 font-semibold leading-snug line-clamp-2" title={stop.title}>{stop.title}</p>}
          <p className="text-ds-13 break-words">
            {stop.address
              ? <span className="font-medium">{stop.address}</span>
              : <span className="text-muted-foreground">
                  Near {stop.area}.{stop.address_shows_at ? ` The drop-off address shows ${day(stop.address_shows_at)}, ${clock(stop.address_shows_at)}, 2 hours before the pickup.` : ""}
                </span>}
          </p>
          <p className="text-ds-13 text-muted-foreground">{PLACE_WORDS[stop.kind][stop.place]}</p>
        </div>
      </div>
      {visit.map((s, n) => (
        <div key={`${s.task_id}:${s.kind}`} className={n > 0 ? "space-y-3 border-t border-border pt-3" : "space-y-3"}>
          {visit.length > 1 && <p className="text-ds-15 font-semibold leading-snug line-clamp-2" title={s.title}>{s.title}</p>}
          {/* A joined pickup can be typed differently (same seller, within 50 m): never hide where it is. */}
          {n > 0 && s.address && s.address !== stop.address && <p className="text-ds-13 font-medium break-words">{s.address}</p>}
          <p className="text-ds-13">
            {pickup && s.slot_start && s.slot_end
              ? <>Pick up {day(s.slot_start)}, {clock(s.slot_start)} to {clock(s.slot_end)}</>
              : <>Drop off about {clock(s.arrive_at)}, any time after the pickup</>}
            {/* D3-9: whole miles rounded up, the same as the delivery's own "about N miles" (declutter_road_miles). */}
            {s.leg_miles > 0 && <span className="text-muted-foreground"> · about {Math.ceil(s.leg_miles)} mi from {s.seq === 1 ? "you" : "the last stop"}</span>}
          </p>
          {s.late && <p className="text-ds-13 font-semibold text-destructive-ink" role="status">You may be late for this pickup time.</p>}
          {s.items.length > 0 && (
            <ul className="flex flex-wrap gap-3" aria-label="Items">
              {s.items.map((it, i) => (
                <li key={`${it.title}-${i}`} className="w-20 space-y-1">
                  {it.photo_path
                    ? <FallbackImg src={photoPublicUrl(it.photo_path)} alt={it.title} className="h-20 w-20 rounded-lg bg-photo-empty object-cover" loading="lazy"
                        fallback={<span aria-hidden className="block h-20 w-20 rounded-lg bg-photo-empty" />} />
                    : <span aria-hidden className="block h-20 w-20 rounded-lg bg-photo-empty" />}
                  <p className="text-ds-12 line-clamp-2">{it.title}</p>
                </li>
              ))}
            </ul>
          )}
          <StopActions stop={s} userId={userId} />
        </div>
      ))}
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
  const visits = routeVisits(stops);
  return (
    <section className="space-y-3" aria-label="Your route">
      <div className="space-y-1">
        <h2 className="text-base font-semibold">Your route</h2>
        <p className="text-ds-13 text-muted-foreground">
          {visits.length} {visits.length === 1 ? "stop" : "stops"} · about {Math.max(1, Math.ceil(miles))} mi · about {drive_minutes} min of driving and stops
        </p>
      </div>
      <Suspense fallback={<div className="h-64 w-full rounded-2xl bg-muted" aria-hidden />}>
        <DeliveryRouteMap stops={stops} />
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
              ? `Opens the next ${maps.count} ${maps.count === 1 ? "stop" : "stops"}; the rest join once those are done.`
              : maps.count === 1 ? "Opens the stop." : `Opens all ${maps.count} stops in this order.`}
            {stops.some((s) => s.kind === "dropoff" && !s.address) && " A drop-off joins once its address shows, 2 hours before its pickup."}
          </p>
        </div>
      )}
      <ol className="space-y-3" aria-label="Stops in order">
        {visits.map((v) => <VisitCard key={`${v[0].task_id}:${v[0].kind}`} visit={v} userId={userId} />)}
      </ol>
      <RouteSuggestions />
    </section>
  );
}
