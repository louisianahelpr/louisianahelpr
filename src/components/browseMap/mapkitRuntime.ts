// Minimal MapKit JS surface used by the browse map, plus the couple of
// geometry helpers the port needs.
//
// WHY HAND-ROLLED TYPES: the same reason `useMapKitJs` and
// `AppleMapPreview` hand-roll theirs — `@types/mapkit-js` has drifted from
// Apple's shipped runtime more than once, and MapKit is loaded from Apple's
// CDN at runtime (no npm package), so nothing would keep the two in sync.
// We describe only the members we actually touch.

export interface MKCoordinate {
  latitude: number;
  longitude: number;
}

export interface MKCoordinateSpan {
  latitudeDelta: number;
  longitudeDelta: number;
}

export interface MKCoordinateRegion {
  center: MKCoordinate;
  span: MKCoordinateSpan;
}

export interface MKAnnotation {
  coordinate: MKCoordinate;
  /** Arbitrary payload — we stash the job id / cluster member list here. */
  data?: Record<string, unknown>;
  clusteringIdentifier?: string | null;
  /** Cluster annotations carry the annotations they stand in for. */
  memberAnnotations?: MKAnnotation[];
  addEventListener?: (type: string, fn: (e: unknown) => void) => void;
}

export interface MKOverlay {
  radius?: number;
  addEventListener?: (type: string, fn: (e: unknown) => void) => void;
}

export interface MKMap {
  element: HTMLElement;
  region: MKCoordinateRegion;
  colorScheme: string;
  cameraBoundary: unknown;
  cameraZoomRange: unknown;
  cameraDistance: number;
  annotations: MKAnnotation[];
  overlays: MKOverlay[];
  /** The currently-selected (callout-open) pins. Set to `[]` to dismiss
   *  whatever callout is open — real MapKit JS API, just not previously
   *  declared here. */
  selectedAnnotations?: MKAnnotation[];
  /** Assigned by us so MapKit can build a branded bubble for each cluster. */
  annotationForCluster?: (cluster: MKAnnotation) => MKAnnotation | undefined;
  addAnnotations: (a: MKAnnotation[]) => void;
  removeAnnotations: (a: MKAnnotation[]) => void;
  addOverlays: (o: MKOverlay[]) => void;
  removeOverlays: (o: MKOverlay[]) => void;
  setRegionAnimated: (region: MKCoordinateRegion, animate?: boolean) => void;
  setCameraDistanceAnimated?: (distance: number, animate?: boolean) => void;
  showItems?: (items: unknown[], options?: Record<string, unknown>) => unknown;
  addEventListener: (type: string, fn: (e: unknown) => void) => void;
  removeEventListener: (type: string, fn: (e: unknown) => void) => void;
  destroy?: () => void;
}

export interface MapKitRuntime {
  Map: new (el: HTMLElement, options?: Record<string, unknown>) => MKMap;
  Coordinate: new (lat: number, lng: number) => MKCoordinate;
  CoordinateSpan: new (latDelta: number, lngDelta: number) => MKCoordinateSpan;
  CoordinateRegion: new (center: MKCoordinate, span: MKCoordinateSpan) => MKCoordinateRegion;
  BoundingRegion?: new (
    north: number,
    east: number,
    south: number,
    west: number,
  ) => { toCoordinateRegion: () => MKCoordinateRegion };
  CameraZoomRange?: new (min: number, max: number) => unknown;
  Annotation: new (
    coordinate: MKCoordinate,
    factory: (coordinate: MKCoordinate, options: Record<string, unknown>) => Element,
    options?: Record<string, unknown>,
  ) => MKAnnotation;
  CircleOverlay: new (
    coordinate: MKCoordinate,
    radiusMeters: number,
    options?: Record<string, unknown>,
  ) => MKOverlay;
  Style: new (options: Record<string, unknown>) => unknown;
  Map_ColorSchemes?: never;
  FeatureVisibility?: { Hidden?: unknown; Visible?: unknown };
}

/** `window.mapkit`, narrowed to the shape this map needs — or null. */
export function getMapKit(): MapKitRuntime | null {
  if (typeof window === "undefined") return null;
  const mk = (window as unknown as { mapkit?: unknown }).mapkit;
  if (!mk) return null;
  return mk as MapKitRuntime;
}

/**
 * MapKit's `Map.ColorSchemes` enum, read defensively.
 *
 * It lives on the CONSTRUCTOR (`mapkit.Map.ColorSchemes.Dark`), not on the
 * mapkit namespace, and older runtimes shipped plain strings. Falling back to
 * the literal keeps the map themed rather than throwing on a runtime that
 * moved the enum.
 */
export function colorSchemeFor(mk: MapKitRuntime, dark: boolean): string {
  const schemes = (mk.Map as unknown as { ColorSchemes?: Record<string, string> }).ColorSchemes;
  if (dark) return schemes?.Dark ?? "dark";
  return schemes?.Light ?? "light";
}

/** A CoordinateRegion covering a [[south, west], [north, east]] box, padded. */
export function regionFromBounds(
  mk: MapKitRuntime,
  bounds: [[number, number], [number, number]],
  padFactor = 1.08,
): MKCoordinateRegion {
  const [[south, west], [north, east]] = bounds;
  const centerLat = (south + north) / 2;
  const centerLng = (west + east) / 2;
  // Guard the degenerate single-point case (one pin) with a small floor so
  // the region never has a zero span, which MapKit renders as a max zoom-in.
  const latDelta = Math.max((north - south) * padFactor, 0.02);
  const lngDelta = Math.max((east - west) * padFactor, 0.02);
  return new mk.CoordinateRegion(
    new mk.Coordinate(centerLat, centerLng),
    new mk.CoordinateSpan(latDelta, lngDelta),
  );
}
