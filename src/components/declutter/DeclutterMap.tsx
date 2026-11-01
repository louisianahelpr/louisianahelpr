/**
 * Declutter Browse's map (owner 2026-10-28: "declutter should have the same search filter and map view as jobs").
 *
 * The same map stack as Jobs' BrowseMap, not a second one: Apple MapKit JS through useMapKitJs, the shared runtime
 * types and Louisiana framing (browseMap/mapkitRuntime, MapLayers, config), the same olive pin and cluster bubble
 * (browseMap/mapMarkers), the same theme follow (useMapFollowsTheme). What differs is only the data: the pins are the
 * items Browse lists under its filters, each at its ROUGH AREA from declutter_map_pins (owner decision 2026-10-28:
 * the public area point moved up to 300 m on the server, the seller's house never shown; the exact spot only after a
 * sale). This file
 * never reads area_lat/area_lng or any other point. Tapping a pin opens a small preview of the item over the map's
 * bottom edge; tapping the preview opens the item page.
 */
import { Button } from "@/components/ui/button";
import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { Loader2, MapPin, MapPinOff, X } from "lucide-react";
import { useMapKitJs } from "@/hooks/useMapKitJs";
import { report } from "@/lib/errorLogger";
import { ReportErrorScreen } from "@/components/ui/ReportErrorScreen";
import { photoPublicUrl, type DeclutterItem, type DeclutterMapPin } from "@/lib/declutter/api";
import { itemPriceLabel, milesLabel } from "@/lib/declutter/distance";
import { LA_BOUNDS, readIsDark } from "@/components/browseMap/config";
import { clusterElement, pinElement, PIN_HEIGHT } from "@/components/browseMap/mapMarkers";
import { fitToPins, laRegion } from "@/components/browseMap/MapLayers";
import { colorSchemeFor, getMapKit, regionFromBounds, type MKAnnotation, type MKMap } from "@/components/browseMap/mapkitRuntime";
import { useMapFollowsTheme } from "@/components/browseMap/useMapLayersSync";
import { FallbackImg } from "./FallbackImg";
import { PhotoPlaceholder } from "@/components/ui/PhotoPlaceholder";
import { categoryIcon } from "@/lib/declutter/categoryIcons";

const ITEM_NOUN = ["item", "items"] as const;

export interface DeclutterMapRow {
  item: DeclutterItem;
  miles: number | null;
}

export default function DeclutterMap({
  rows,
  pins,
  pinsLoading,
  pinsError,
  onRetry,
  cover,
  approximate,
  flush = false,
}: {
  /** What Browse lists right now (its filters and search applied). */
  rows: DeclutterMapRow[];
  /** declutter_map_pins: item id -> its rough-area point. */
  pins: Map<string, DeclutterMapPin> | undefined;
  pinsLoading: boolean;
  pinsError: boolean;
  onRetry: () => void;
  cover: Map<string, string>;
  approximate: boolean;
  /** The desktop column: edge to edge, no rounded border of its own (BrowseMap's `flush`). */
  flush?: boolean;
}) {
  const status = useMapKitJs();
  const unusable = status === "missing-token" || status === "error";
  const mapRef = useRef<MKMap | null>(null);
  const annotationsRef = useRef<MKAnnotation[]>([]);
  const [containerEl, setContainerEl] = useState<HTMLDivElement | null>(null);
  const [mapReady, setMapReady] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  // Only items Browse lists AND the server gave a pin: the map and the list describe one set.
  const placed = useMemo(
    () => rows.flatMap((r) => {
      const p = pins?.get(r.item.id);
      return p ? [{ ...r, latitude: p.lat, longitude: p.lng }] : [];
    }),
    [rows, pins],
  );
  const selected = placed.find((p) => p.item.id === selectedId) ?? null;

  // Build the map once MapKit is ready and the box exists.
  useEffect(() => {
    if (status !== "ready" || mapRef.current || !containerEl) return;
    const mk = getMapKit();
    if (!mk) return;
    try {
      const map = new mk.Map(containerEl, {
        region: laRegion(mk),
        cameraBoundary: regionFromBounds(mk, LA_BOUNDS, 1),
        cameraZoomRange: mk.CameraZoomRange ? new mk.CameraZoomRange(0, 1_500_000) : undefined,
        colorScheme: colorSchemeFor(mk, readIsDark()),
        showsCompass: mk.FeatureVisibility?.Hidden ?? "hidden",
        showsScale: mk.FeatureVisibility?.Hidden ?? "hidden",
        // NIGHT-BUYINGrealma-3: the desktop column has a mouse and no pinch, so it gets MapKit's + and - buttons; the
        // phone map stays clean (pinch zooms).
        showsZoomControl: flush,
        showsMapTypeControl: false,
        showsUserLocationControl: false,
        isRotationEnabled: false,
      });
      map.annotationForCluster = (cluster) => {
        const members = cluster.memberAnnotations ?? [];
        return new mk.Annotation(
          cluster.coordinate,
          () => clusterElement(members.length, () => {
            const lats = members.map((m) => m.coordinate.latitude);
            const lngs = members.map((m) => m.coordinate.longitude);
            if (!lats.length) return;
            map.setRegionAnimated(regionFromBounds(mk, [[Math.min(...lats), Math.min(...lngs)], [Math.max(...lats), Math.max(...lngs)]], 1.4), true);
          }, ITEM_NOUN),
          { calloutEnabled: false },
        );
      };
      mapRef.current = map;
      setMapReady(true);
    } catch (e) {
      report(e instanceof Error ? e : new Error("Declutter map construction failed"), { tags: { source: "DeclutterMap.mapkit" } });
    }
  }, [status, containerEl]);

  useEffect(() => () => {
    try {
      mapRef.current?.destroy?.();
    } catch (e) {
      console.warn("[declutter map] destroy", e);
    }
    mapRef.current = null;
    annotationsRef.current = [];
  }, []);

  useMapFollowsTheme(mapRef, mapReady);

  // The pins, rebuilt whenever the listed set changes; the camera frames them.
  const placedKey = placed.map((p) => `${p.item.id}:${p.latitude},${p.longitude}`).join("|");
  useEffect(() => {
    const mk = getMapKit();
    const map = mapRef.current;
    if (!mk || !map || !mapReady) return;
    try {
      if (annotationsRef.current.length) map.removeAnnotations(annotationsRef.current);
      const annotations = placed.map((p) => new mk.Annotation(
        new mk.Coordinate(p.latitude, p.longitude),
        () => pinElement({
          category: p.item.category,
          isUrgent: false,
          jobId: p.item.id,
          label: `${p.item.title} — ${itemPriceLabel(p.item.current_price_cents)} — near ${p.item.area_label}`,
          onActivate: () => setSelectedId(p.item.id),
        }),
        {
          anchorOffset: typeof DOMPoint === "function" ? new DOMPoint(0, -PIN_HEIGHT / 2) : undefined,
          clusteringIdentifier: "declutter-item",
          calloutEnabled: false,
          data: { itemId: p.item.id },
        },
      ));
      annotationsRef.current = annotations;
      map.addAnnotations(annotations);
      fitToPins(mk, map, placed, false);
    } catch (e) {
      report(e instanceof Error ? e : new Error("Declutter map pins failed"), { tags: { source: "DeclutterMap.pins" } });
    }
    // placedKey stands for `placed` (a new array every render).
  }, [placedKey, mapReady]);

  useEffect(() => {
    if (selectedId && !placed.some((p) => p.item.id === selectedId)) setSelectedId(null);
  }, [placed, selectedId]);

  const shell = flush ? "" : " rounded-2xl border border-border";
  if (pinsError && !pins) {
    return (
      <div className={`flex h-full w-full flex-col items-center justify-center gap-3 bg-card/40 px-6 text-center${shell}`} role="status">
        <ReportErrorScreen source="DeclutterMap.pins" title="We couldn't load the map." />
        <MapPinOff className="h-6 w-6 text-muted-foreground" aria-hidden />
        <p className="text-ds-15 font-semibold text-foreground">We couldn't load the map.</p>
        <Button type="button" variant="ghost" size="sm" onClick={onRetry} className="text-ds-13 tracking-normal text-[hsl(var(--sage-ink))]">Try again</Button>
      </div>
    );
  }

  return (
    <div data-declutter-map="" className={`relative h-full w-full overflow-hidden bg-card/40${shell}`}>
      <div ref={setContainerEl} className="absolute inset-0" aria-label="Map of items for sale" role="region" />
      {(pinsLoading || (!mapReady && !unusable)) && (
        <div aria-hidden className="pointer-events-none absolute inset-0 z-[300] flex items-center justify-center" style={{ background: "hsl(var(--surface-band) / 0.55)" }}>
          <Loader2 className="h-5 w-5 animate-spin" style={{ color: "hsl(var(--bark) / 0.6)" }} />
        </div>
      )}
      {unusable && (
        <div role="status" className="absolute inset-0 z-[360] flex flex-col items-center justify-center gap-2 px-6 text-center" style={{ background: "hsl(var(--surface-band) / 0.96)" }}>
          <MapPinOff className="h-6 w-6 text-muted-foreground" aria-hidden />
          <p className="text-ds-13 font-semibold text-foreground">The map isn't available right now.</p>
          <p className="text-ds-12 text-muted-foreground">Every item is still in the list.</p>
        </div>
      )}
      {!unusable && !pinsLoading && placed.length === 0 && (
        <div className="pointer-events-none absolute inset-0 z-[350] flex items-center justify-center px-6">
          <div className="pointer-events-auto flex max-w-[280px] flex-col items-center gap-2 rounded-2xl border border-border bg-card/95 px-5 py-5 text-center">
            <MapPin className="h-6 w-6 text-[hsl(var(--bark))]" strokeWidth={1.5} aria-hidden />
            <p className="text-ds-15 font-semibold text-foreground">No items on the map here.</p>
          </div>
        </div>
      )}
      {/* Every pin is a rough area, so the map says so once (owner 2026-10-28). */}
      {!unusable && placed.length > 0 && !selected && (
        <p className="pointer-events-none absolute left-3 top-3 z-[400] rounded-full border border-border bg-card/95 px-3 py-1 text-ds-12 text-muted-foreground">
          Pins show the rough area, not the exact spot.
        </p>
      )}
      {selected && (
        <div className="absolute inset-x-3 bottom-3 z-[450] flex justify-center">
          <div className="relative w-full max-w-[26rem]">
            <Link
              to={`/declutter/item/${selected.item.id}`}
              data-map-preview=""
              className="flex items-center gap-3 rounded-2xl border border-border bg-card p-2.5 pr-12 shadow-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <span className="relative h-16 w-16 shrink-0 overflow-hidden rounded-xl bg-photo-empty">
                {/* DA-15: the one missing-photo look, the category icon, under the photo as on every card. */}
                <PhotoPlaceholder icon={categoryIcon(selected.item.category)} seed={selected.item.category} className="absolute inset-0 h-full w-full" iconClassName="h-6 w-6" />
                {cover.get(selected.item.id) && <FallbackImg src={photoPublicUrl(cover.get(selected.item.id)!)} alt="" className="relative h-full w-full object-cover" />}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-ds-15 font-bold tabular-nums text-[hsl(var(--burnt-sienna))]">{itemPriceLabel(selected.item.current_price_cents)}</span>
                <span className="block truncate text-ds-15 font-semibold text-foreground" title={selected.item.title}>{selected.item.title}</span>
                {/* NIGHT-BUYINGrealma-2: "Mid-City, Baton Rouge · 2 ..." cut the miles, the one number that matters on a map.
                    The place may be cut; the miles have their own line and never are. */}
                {selected.item.area_label && <span className="block truncate text-ds-12 text-muted-foreground" title={selected.item.area_label}>{selected.item.area_label}</span>}
                {milesLabel(selected.miles, approximate) && (
                  <span className="block whitespace-nowrap text-ds-12 font-medium text-foreground" data-map-preview-miles="">{milesLabel(selected.miles, approximate)}</span>
                )}
              </span>
            </Link>
            <button
              type="button"
              aria-label="Close preview"
              onClick={() => setSelectedId(null)}
              className="ctl-exit ctl-tint absolute right-1.5 top-1/2 flex h-10 w-10 -translate-y-1/2 items-center justify-center"
            >
              <X className="h-4 w-4" aria-hidden />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
