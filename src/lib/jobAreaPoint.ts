import { getCentroidFromLocation, getParishCentroid } from "@/lib/parishCentroids";

/**
 * Where a job is, for a radius filter. Its own (masked) coordinate pair when it has one; when its address never
 * geocoded (owner bug 2026-11-10: a New Iberia job saved with no coordinates and dropped out of distance lists), the
 * centre of its parish, else the parish its town is in. `approximate` says the second kind. null only when the job
 * gives nothing to place it by. The map does the same on the server (20261110210539, ZIP centroid first).
 */
export function jobAreaPoint(job: {
  latitude?: number | string | null;
  longitude?: number | string | null;
  parish?: string | null;
  location?: string | null;
}): { lat: number; lng: number; approximate: boolean } | null {
  const lat = job.latitude == null ? NaN : Number(job.latitude);
  const lng = job.longitude == null ? NaN : Number(job.longitude);
  if (Number.isFinite(lat) && Number.isFinite(lng)) return { lat, lng, approximate: false };
  const area = getParishCentroid(job.parish) ?? getCentroidFromLocation(job.location);
  return area ? { ...area, approximate: true } : null;
}
