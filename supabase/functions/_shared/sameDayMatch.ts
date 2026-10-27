// Q2438 (owner-approved 2026-10-27): same-day jobs reach the Helprs who are
// ONLINE right now and nearby, first.
//
// "Online" is the existing "Available now" switch (Profile > Availability),
// stored as profiles.available_until: a Helpr is online while that instant is
// still in the future. "Nearby" is the same parish as the job, or, when both
// sides have coordinates, within SAME_DAY_RADIUS_MILES as the crow flies.
//
// Pure (no Deno, no Supabase), so src/test/sameDayJobs.test.ts runs it as is.
// instant-job-match puts these Helprs at the head of its ranked list, which
// matters because enqueue_instant_job_match sends at most 20 matches a job.

/** How far an online Helpr may be from a same-day job, in straight-line miles. */
const SAME_DAY_RADIUS_MILES = 25;

/** Score given to an online, nearby Helpr on a same-day job: above any skill/location score (max 6). */
export const SAME_DAY_ONLINE_SCORE = 10;

/** `YYYY-MM-DD` for `now` in Louisiana (jobs.date_needed is a Louisiana calendar day). */
function louisianaYmd(now: Date): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Chicago",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}

/** True when the job is for Louisiana's today. */
export function isSameDayJob(dateNeeded: string | null | undefined, now: Date): boolean {
  return typeof dateNeeded === "string" && dateNeeded.slice(0, 10) === louisianaYmd(now);
}

/** True while the Helpr's "Available now" window is open. */
export function isOnlineNow(availableUntil: string | null | undefined, now: Date): boolean {
  if (!availableUntil) return false;
  const t = new Date(availableUntil).getTime();
  return Number.isFinite(t) && t > now.getTime();
}

function num(v: unknown): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/** Great-circle distance in miles. */
export function milesBetween(aLat: number, aLng: number, bLat: number, bLng: number): number {
  const R = 3958.8;
  const rad = (d: number) => (d * Math.PI) / 180;
  const dLat = rad(bLat - aLat);
  const dLng = rad(bLng - aLng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(aLat)) * Math.cos(rad(bLat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

export interface SameDayJobPlace {
  parish?: string | null;
  latitude?: number | string | null;
  longitude?: number | string | null;
}

export interface SameDayHelprPlace {
  parish?: string | null;
  latitude?: number | string | null;
  longitude?: number | string | null;
  available_until?: string | null;
}

/** Same parish (case-insensitive), or within SAME_DAY_RADIUS_MILES when both have coordinates. */
export function isNearby(job: SameDayJobPlace, helpr: SameDayHelprPlace): boolean {
  const jp = (job.parish ?? "").trim().toLowerCase();
  const hp = (helpr.parish ?? "").trim().toLowerCase();
  if (jp && hp && jp === hp) return true;
  const [jLat, jLng, hLat, hLng] = [num(job.latitude), num(job.longitude), num(helpr.latitude), num(helpr.longitude)];
  if (jLat === null || jLng === null || hLat === null || hLng === null) return false;
  return milesBetween(jLat, jLng, hLat, hLng) <= SAME_DAY_RADIUS_MILES;
}

/** The same-day boost for one Helpr: SAME_DAY_ONLINE_SCORE when online and nearby on a same-day job, else 0. */
export function sameDayBoost(
  job: SameDayJobPlace & { date_needed?: string | null },
  helpr: SameDayHelprPlace,
  now: Date,
): number {
  if (!isSameDayJob(job.date_needed, now)) return 0;
  if (!isOnlineNow(helpr.available_until, now)) return 0;
  return isNearby(job, helpr) ? SAME_DAY_ONLINE_SCORE : 0;
}
