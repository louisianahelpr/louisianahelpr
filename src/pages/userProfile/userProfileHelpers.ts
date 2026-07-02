import { haversineMiles } from "@/lib/geo";
import type { GeoState } from "@/hooks/useUserLocation";
import type { LastActiveLabel, ProfileJob } from "./types";

// Radius (miles) used by the "did N jobs nearby" social-proof badge (#31).
export const NEARBY_RADIUS_MI = 25;

// Active-cohort label (#5). Cohort-based copy ("Active today" / "Active
// this week") instead of exact "2h ago" — a privacy nudge so a viewer
// can't pattern-match someone's online routine. Same two visual states
// as before: "live" (green pulse) within 10 minutes, muted olivewood
// otherwise. Returns null beyond 7 days so stale presence doesn't
// mislead. The "Active now" label stays because it's already a coarse
// 10-minute bucket, not a real-time indicator.
export function computeLastActiveLabel(lastActiveAt: Date | null): LastActiveLabel | null {
  if (!lastActiveAt) return null;
  const ms = Date.now() - lastActiveAt.getTime();
  if (ms < 0) return null; // clock skew safeguard
  if (ms < 10 * 60_000) return { text: "Active now", isLive: true };
  if (ms < 24 * 60 * 60_000) return { text: "Active today", isLive: false };
  if (ms < 7 * 24 * 60 * 60_000) return { text: "Active this week", isLive: false };
  return null;
}

// Count of this helper's completed jobs that fell within NEARBY_RADIUS_MI of
// the viewer's current location. Only counts jobs with usable lat/lng; older
// posts without coords are silently skipped. Returns null until the viewer's
// location is ready.
export function computeJobsNearbyCount(
  viewerLoc: GeoState,
  workedJobs: ProfileJob[],
): number | null {
  if (viewerLoc.status !== "ready") return null;
  let n = 0;
  for (const j of workedJobs) {
    if (j.status !== "completed") continue;
    if (typeof j.latitude !== "number" || typeof j.longitude !== "number") continue;
    if (haversineMiles(viewerLoc.lat, viewerLoc.lng, j.latitude, j.longitude) <= NEARBY_RADIUS_MI) {
      n += 1;
    }
  }
  return n;
}
