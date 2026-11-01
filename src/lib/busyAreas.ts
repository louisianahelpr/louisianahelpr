/**
 * Q2435 (owner-approved 2026-10-27), part A: "Busy right now". Where open jobs
 * and open deliveries are waiting, by PARISH, as counts only.
 *
 * Built from rows the page already reads, so it shows nothing new: Jobs
 * Browse's map rows (get_open_jobs_for_map, which carry the job's parish) and
 * the Deliver page's open tasks (helpr_tasks_open_near, which carry an area
 * label such as "Downtown, Baton Rouge"). An area label is turned into a
 * parish through the app's own city registry (parishForCity), trying each
 * part from the end; a label it cannot place is counted under "elsewhere",
 * never guessed onto the map. No address or coordinate of any job or item
 * is used: a parish is drawn at its centroid (PARISH_CENTROIDS).
 */
import { getParishCentroid } from "@/lib/parishCentroids";
import { parishForCity } from "@/lib/parishes";

export interface BusyArea {
  parish: string;
  jobs: number;
  deliveries: number;
  total: number;
  center: { lat: number; lng: number };
}

export interface BusyAreasSummary {
  areas: BusyArea[];
  /** Open rows whose place could not be named as a parish. */
  elsewhere: number;
}

/** "Lafayette" or "Lafayette Parish" -> "Lafayette"; null for blank. */
function cleanParish(p: string | null | undefined): string | null {
  const t = (p ?? "").replace(/\s+Parish\s*$/i, "").trim();
  return t || null;
}

/** An area label ("Downtown, Baton Rouge", "Broussard, LA") -> its parish name, or null. */
export function parishForAreaLabel(label: string | null | undefined): string | null {
  // AUD31-10: "New Iberia & Delcambre" (a prod pickup area, read 10-31) names two towns; each is a part.
  const parts = (label ?? "").split(/,|&|\//).map((s) => s.trim()).filter((s) => s && !/^LA$/i.test(s) && !/^Louisiana$/i.test(s));
  for (let i = parts.length - 1; i >= 0; i--) {
    const parish = parishForCity(parts[i]);
    if (parish) return cleanParish(parish.name);
    const named = parts[i].match(/^(.+?)\s+Parish$/i);
    if (named && getParishCentroid(named[1])) return cleanParish(named[1]);
  }
  return null;
}

export function busyAreas(
  jobs: ReadonlyArray<{ parish?: string | null }>,
  deliveries: ReadonlyArray<{ pickup_area?: string | null; open_count?: number }>,
): BusyAreasSummary {
  const by = new Map<string, { jobs: number; deliveries: number }>();
  let elsewhere = 0;
  // `n`: a delivery row from helpr_tasks_open_count carries its area's count (audit 1c D3-6); a listed task is one.
  const add = (parish: string | null, kind: "jobs" | "deliveries", n = 1) => {
    const center = parish ? getParishCentroid(parish) : null;
    if (!parish || !center) {
      elsewhere += n;
      return;
    }
    const row = by.get(parish) ?? { jobs: 0, deliveries: 0 };
    row[kind] += n;
    by.set(parish, row);
  };
  for (const j of jobs) add(cleanParish(j.parish), "jobs");
  for (const d of deliveries) add(parishForAreaLabel(d.pickup_area), "deliveries", Math.max(0, d.open_count ?? 1));
  const areas = [...by.entries()]
    .map(([parish, c]) => ({ parish, jobs: c.jobs, deliveries: c.deliveries, total: c.jobs + c.deliveries, center: getParishCentroid(parish)! }))
    .sort((a, b) => b.total - a.total || a.parish.localeCompare(b.parish));
  return { areas, elsewhere };
}


/** Circle size on the map: 5 km for one, up to 20 km for the busiest parish. */
export function busyCircleRadiusMeters(total: number, maxTotal: number): number {
  if (!(total > 0) || !(maxTotal > 0)) return 0;
  return Math.round(5000 + 15000 * Math.sqrt(Math.min(total, maxTotal) / maxTotal));
}

/** A busy circle as ground geometry, so the map can frame its full extent (A2-L14). */
export interface BusyCircle {
  lat: number;
  lng: number;
  radiusMeters: number;
}

/** The circles drawBusyAreas paints, as plain geometry (same centre, same radius). */
export function busyAreaCircles(areas: readonly BusyArea[]): BusyCircle[] {
  const max = areas.reduce((m, a) => Math.max(m, a.total), 0);
  if (max === 0) return [];
  return areas.map((a) => ({ lat: a.center.lat, lng: a.center.lng, radiusMeters: busyCircleRadiusMeters(a.total, max) }));
}

/** Shade 0.3 (quiet) to 0.65 (busiest), so busier parishes read darker. */
export function busyCircleOpacity(total: number, maxTotal: number): number {
  if (!(total > 0) || !(maxTotal > 0)) return 0;
  return Math.round((0.3 + 0.35 * (Math.min(total, maxTotal) / maxTotal)) * 100) / 100;
}

/**
 * NIGHT-JOBSMA5-4: zoomed in to street level a parish circle (5-20 km across) tints the whole map. Below this
 * north-south span (degrees, ~17 km) the circles are dimmed to BUSY_DIM_FACTOR of their usual fill.
 */
const BUSY_DIM_BELOW_LAT_DELTA = 0.15;
export const BUSY_DIM_FACTOR = 0.3;
export const busyCirclesDimmed = (latitudeDelta: number | null | undefined): boolean =>
  typeof latitudeDelta === "number" && latitudeDelta > 0 && latitudeDelta < BUSY_DIM_BELOW_LAT_DELTA;

const n = (k: number, one: string, many: string) => `${k} ${k === 1 ? one : many}`;

/** "Lafayette Parish: 5 jobs, 2 deliveries" (a zero side is left out). */
export function busyAreaLabel(a: Pick<BusyArea, "parish" | "jobs" | "deliveries">): string {
  const bits = [a.jobs ? n(a.jobs, "job", "jobs") : null, a.deliveries ? n(a.deliveries, "delivery", "deliveries") : null].filter(Boolean);
  return `${a.parish} Parish: ${bits.join(", ")}`;
}
