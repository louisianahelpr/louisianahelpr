/**
 * The in-app route map (owner add-on 2026-10-27: no bouncing between Apple Maps and the app).
 * Apple MapKit JS, the SDK the app already loads (useMapKitJs, token from the mapkit-token edge
 * function): every stop with a known point as a numbered pin, the driving line between them
 * (MapKit JS Directions, one request per leg), and, once the Helpr taps "Start", their live
 * position and the next turn ("In 0.4 mi, turn right on Main St"), advancing as they move, with the
 * current stop's Picked up / Left at the door right under the map.
 *
 * Location: navigator.geolocation.watchPosition only after "Start", only while this screen is
 * open (cleared on "Stop" and on unmount). Apple's Directions receives it as the route start,
 * rounded to ~100 m (lh-authz-rls review #1). Open in Maps stays for spoken turn-by-turn.
 *
 * Delivery live map (owner 11-01; 20261101184555): while tracking, the position is also sent to
 * our server at most every SHARE_MS (helpr_share_position) for the Helpr's deliveries in hand: the
 * seller sees it from Start to Picked up, the buyer from Picked up to delivered. The server keeps
 * one row per delivery, overwritten, deleted on every status change; "Stop" and leaving this
 * screen delete it (helpr_stop_sharing). No history is kept.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { useMapKitJs } from "@/hooks/useMapKitJs";
import { nextStep, routeVisits, type LatLng, type NavStep } from "@/lib/declutter/route";
import { shareMyPosition, stopSharingPosition, type RouteStop } from "@/lib/helprTasks/api";

// The MapKit JS members this map touches (Apple's runtime is loosely typed; see AppleMapPreview).
interface MkCoordinate { latitude: number; longitude: number }
interface MkPolyline { points: MkCoordinate[]; style: unknown }
// Measured 2026-10-27 against MapKit JS 5.x: a step carries `path` (its coordinates; the turn is at
// path[0]) and no polyline; step 0 is the start, with no instructions.
interface MkRoute { polyline: MkPolyline; steps: { instructions?: string; distance: number; path?: MkCoordinate[] }[] }
interface MkMap {
  addAnnotations: (a: unknown[]) => void;
  removeAnnotations: (a: unknown[]) => void;
  addAnnotation: (a: unknown) => void;
  addOverlays: (o: unknown[]) => void;
  removeOverlays: (o: unknown[]) => void;
  showItems: (items: unknown[], options?: Record<string, unknown>) => void;
  destroy?: () => void;
}
interface MkAnnotation { coordinate: MkCoordinate }
interface MkRuntime {
  Coordinate: new (lat: number, lng: number) => MkCoordinate;
  CoordinateSpan?: new (latDelta: number, lngDelta: number) => unknown;
  Map: new (el: HTMLElement, options: Record<string, unknown>) => MkMap;
  MarkerAnnotation: new (c: MkCoordinate, o: Record<string, unknown>) => MkAnnotation;
  Style: new (o: Record<string, unknown>) => unknown;
  FeatureVisibility?: { Hidden?: unknown };
  Directions?: (new () => {
    route: (req: Record<string, unknown>, cb: (err: unknown, data: { routes?: MkRoute[] }) => void) => void;
  }) & { Transport?: { Automobile?: unknown } };
}

function cssColor(varName: string, fallback: string): string {
  const v = typeof document === "undefined" ? "" : getComputedStyle(document.documentElement).getPropertyValue(varName).trim();
  return v ? `hsl(${v})` : fallback;
}

/** One Directions request, as a promise (null on any failure: the pins still show). */
function legRoute(mk: MkRuntime, from: LatLng, to: LatLng): Promise<MkRoute | null> {
  return new Promise((resolve) => {
    try {
      if (!mk.Directions) { resolve(null); return; }
      new mk.Directions().route({
        origin: new mk.Coordinate(from.lat, from.lng),
        destination: new mk.Coordinate(to.lat, to.lng),
        transportType: mk.Directions.Transport?.Automobile,
      }, (err, data) => resolve(err ? null : data?.routes?.[0] ?? null));
    } catch (err) {
      console.warn("[route map] directions", err);
      resolve(null);
    }
  });
}

const toSteps = (r: MkRoute | null): NavStep[] =>
  (r?.steps ?? []).flatMap((s) => (s.path?.length
    ? [{ instructions: s.instructions ?? "", start: { lat: s.path[0].latitude, lng: s.path[0].longitude } }]
    : []));

/** Re-ask Directions for the current leg after moving this far, at most this often. */
const REROUTE_M = 400;
const REROUTE_MS = 30_000;
/** Send the live position to the seller/buyer at most this often (the viewers poll every 10 s). */
export const SHARE_MS = 15_000;
/**
 * Audit 1c D3-9: with one pin, showItems zoomed to the street around it. Never closer than about 3 km across (MapKit
 * JS showItems `minimumSpan`), so the area around a lone stop shows.
 */
export const MIN_SPAN_DEG = 0.03;
const fitOptions = (mk: MkRuntime) => (mk.CoordinateSpan ? { minimumSpan: new mk.CoordinateSpan(MIN_SPAN_DEG, MIN_SPAN_DEG) } : undefined);

export default function DeliveryRouteMap({ stops }: { stops: RouteStop[] }) {
  const status = useMapKitJs();
  const el = useRef<HTMLDivElement>(null);
  const map = useRef<MkMap | null>(null);
  const me = useRef<MkAnnotation | null>(null);
  const legOverlays = useRef<unknown[]>([]);
  const pinsRef = useRef<MkAnnotation[]>([]);
  const lastRoute = useRef<{ at: LatLng; t: number } | null>(null);
  const [tracking, setTracking] = useState(false);
  const [here, setHere] = useState<LatLng | null>(null);
  const [locError, setLocError] = useState<string | null>(null);
  const [steps, setSteps] = useState<NavStep[]>([]);
  const [stepIdx, setStepIdx] = useState(1);
  // One pin per visit (D3-2: pickups joined into one visit share a seq and a point).
  const pinned = useMemo(() => routeVisits(stops).map((v) => v[0]).filter((s) => s.lat !== null && s.lng !== null), [stops]);
  const current = stops[0];
  const ready = status === "ready" && !!window.mapkit;

  // The map and the numbered pins.
  useEffect(() => {
    if (!ready || !el.current || pinned.length === 0) return;
    const mk = window.mapkit as unknown as MkRuntime;
    let pins: MkAnnotation[] = [];
    try {
      if (!map.current) {
        map.current = new mk.Map(el.current, {
          showsCompass: mk.FeatureVisibility?.Hidden ?? 0,
          showsScale: mk.FeatureVisibility?.Hidden ?? 0,
          showsMapTypeControl: false,
        });
      }
      pins = pinned.map((s) => new mk.MarkerAnnotation(new mk.Coordinate(s.lat as number, s.lng as number), {
        glyphText: String(s.seq),
        color: s.kind === "pickup" ? cssColor("--primary", "#4B5320") : cssColor("--burnt-sienna", "#A65A40"),
        title: `${s.seq}. ${s.kind === "pickup" ? "Pick up" : "Drop off"}`,
        subtitle: s.title,
      }));
      map.current.addAnnotations(pins);
      pinsRef.current = pins;
      map.current.showItems(pins, fitOptions(mk));
    } catch (err) {
      console.warn("[route map] pins", err);
    }
    return () => {
      try { if (pins.length) map.current?.removeAnnotations(pins); } catch (err) { console.warn("[route map] unpin", err); }
    };
  }, [ready, pinned]);

  useEffect(() => () => {
    try { map.current?.destroy?.(); } catch (err) { console.warn("[route map] destroy", err); }
    map.current = null;
  }, []);

  // The driving line: from the Helpr (once known) through every pinned stop, one Directions request per leg.
  const hereKey = here ? `${here.lat.toFixed(3)},${here.lng.toFixed(3)}` : "";
  useEffect(() => {
    if (!ready || !map.current || pinned.length === 0) return;
    const mk = window.mapkit as unknown as MkRuntime;
    const now = Date.now();
    const last = lastRoute.current;
    if (here && last && now - last.t < REROUTE_MS) return;
    if (here && last && Math.hypot(here.lat - last.at.lat, here.lng - last.at.lng) * 111_000 < REROUTE_M && steps.length) return;
    const start = here ? { lat: Number(here.lat.toFixed(3)), lng: Number(here.lng.toFixed(3)) } : null;
    const points: LatLng[] = [...(start ? [start] : []), ...pinned.map((s) => ({ lat: s.lat as number, lng: s.lng as number }))];
    if (points.length < 2) return;
    let cancelled = false;
    void Promise.all(points.slice(1).map((to, i) => legRoute(mk, points[i], to))).then((legs) => {
      if (cancelled || !map.current) return;
      const style = new mk.Style({ lineWidth: 5, strokeColor: cssColor("--primary", "#4B5320"), strokeOpacity: 0.85 });
      const lines = legs.filter((l): l is MkRoute => !!l).map((l) => { l.polyline.style = style; return l.polyline; });
      try {
        map.current.removeOverlays(legOverlays.current);
        map.current.addOverlays(lines);
        if (!here) map.current.showItems([...pinsRef.current, ...lines], fitOptions(mk));
      } catch (err) {
        console.warn("[route map] line", err);
      }
      legOverlays.current = lines;
      if (here) {
        lastRoute.current = { at: here, t: now };
        setSteps(toSteps(legs[0]));
        setStepIdx(1);
      }
    });
    return () => { cancelled = true; };
    // hereKey (~100 m) rather than `here`, so a GPS jitter does not re-ask Directions.
  }, [ready, pinned, hereKey]);

  // Live position, only while tracking (after "Start"); never stored or sent to our server.
  useEffect(() => {
    if (!tracking) return;
    if (!("geolocation" in navigator)) { setLocError("This device can't share its location."); setTracking(false); return; }
    const id = navigator.geolocation.watchPosition(
      (p) => { setLocError(null); setHere({ lat: p.coords.latitude, lng: p.coords.longitude }); },
      (e) => { setLocError(e.code === e.PERMISSION_DENIED ? "Location is off for Louisiana Helpr. Turn it on in Settings to see your next turn." : "We couldn't find your location."); },
      { enableHighAccuracy: true, maximumAge: 5_000, timeout: 20_000 },
    );
    return () => navigator.geolocation.clearWatch(id);
  }, [tracking]);

  // Delivery live map: share the position while tracking (throttled); Stop and leaving the screen delete it.
  // Also on a timer, so a Helpr standing still (no new GPS fix) does not drop off the viewers' map after 2 minutes.
  const lastShare = useRef(0);
  const hereRef = useRef<LatLng | null>(null);
  hereRef.current = here;
  useEffect(() => {
    if (!tracking || !here || Date.now() - lastShare.current < SHARE_MS) return;
    lastShare.current = Date.now();
    shareMyPosition(here.lat, here.lng).catch((err) => console.warn("[route map] share", err));
  }, [tracking, here]);
  useEffect(() => {
    if (!tracking) return;
    const id = window.setInterval(() => {
      const p = hereRef.current;
      if (!p || Date.now() - lastShare.current < SHARE_MS) return;
      lastShare.current = Date.now();
      shareMyPosition(p.lat, p.lng).catch((err) => console.warn("[route map] share", err));
    }, SHARE_MS);
    return () => {
      window.clearInterval(id);
      lastShare.current = 0;
      stopSharingPosition().catch((err) => console.warn("[route map] stop sharing", err));
    };
  }, [tracking]);

  // The Helpr's own dot.
  useEffect(() => {
    if (!ready || !map.current || !here) return;
    const mk = window.mapkit as unknown as MkRuntime;
    try {
      const c = new mk.Coordinate(here.lat, here.lng);
      if (me.current) me.current.coordinate = c;
      else {
        me.current = new mk.MarkerAnnotation(c, { glyphText: "", color: "#2563EB", title: "You" });
        map.current.addAnnotation(me.current);
      }
    } catch (err) {
      console.warn("[route map] me", err);
    }
  }, [ready, here]);
  useEffect(() => { if (!tracking && me.current && map.current) { try { map.current.removeAnnotations([me.current]); } catch (err) { console.warn("[route map] me off", err); } me.current = null; } }, [tracking]);

  const nav = here && steps.length ? nextStep(steps, stepIdx, here) : null;
  useEffect(() => { if (nav && nav.index !== stepIdx) setStepIdx(nav.index); }, [nav, stepIdx]);

  if (status === "missing-token" || status === "error") {
    return <p className="text-ds-13 text-muted-foreground">The map isn't available right now. Open in Maps below still works.</p>;
  }
  if (pinned.length === 0) return null;
  return (
    <div className="space-y-3">
      <div ref={el} className="h-64 w-full overflow-hidden rounded-2xl bg-muted lg:h-96" role="img"
        aria-label={`Map of your route: ${pinned.map((s) => `${s.seq}, ${s.kind === "pickup" ? "pick up" : "drop off"}`).join("; ")}`} />
      <div className="rounded-2xl border border-border bg-card p-4 space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-ds-15 font-semibold" aria-live="polite">
            {!tracking ? "Tap Start to see your next turn here."
              : nav?.line ? nav.line
              : here ? `Arriving at stop ${current.seq}.` : "Finding your location…"}
          </p>
          <button type="button" className="min-h-11 rounded-full border border-border px-4 py-2 text-sm font-semibold"
            onClick={() => setTracking((t) => !t)} aria-pressed={tracking}>
            {tracking ? "Stop" : "Start"}
          </button>
        </div>
        {locError && <p className="text-ds-13" role="alert">{locError}</p>}
        <p className="text-ds-12 text-muted-foreground">After Start, the seller sees where you are until you pick it up, then the buyer until you deliver it. Only while this screen is open; it's deleted when you tap Stop or deliver.</p>
        {current && (
          <div className="space-y-2 border-t border-border pt-3">
            {/* Audit 1c D3-9: the photo step showed here, on the stop card and on Your deliveries. It lives on the stop
                card below; this panel names the next stop only. */}
            <p className="text-ds-13 font-semibold">
              Next: stop {current.seq}, {current.kind === "pickup" ? "pick up" : "drop off"} · {current.address ?? `near ${current.area}`}
            </p>
            <p className="text-ds-12 text-muted-foreground">Its photo step is on the stop below.</p>
          </div>
        )}
      </div>
    </div>
  );
}
