// Quiet-hours window evaluation.
//
// Split out of index.ts so it can be unit-tested: index.ts calls `Deno.serve`
// at module load, so vitest cannot import it.
//
// TIMEZONE (N-003). notification_preferences.quiet_start / quiet_end are
// `time without time zone` values written straight from an
// <input type="time"> on /profile?tab=notifications (NotificationPreferences
// .tsx) and drawn on a "24hr local" clock (QuietHoursClock.tsx). They are
// wall-clock times in the user's own zone. No per-user timezone is stored
// anywhere (measured 2026-09-23: information_schema has no timezone/tz column
// on any public table), and every user is in Louisiana, so the window is
// evaluated in America/Chicago — which also tracks CST/CDT automatically.
// Evaluating it in UTC (the old code) put a 22:00-07:00 window at 17:00-02:00
// Louisiana time. If a per-user timezone column is ever added, pass it as
// `timeZone`.
export const QUIET_HOURS_TIME_ZONE = 'America/Chicago'

// Parse a Postgres `time` value (typically `HH:MM:SS` or `HH:MM`) into
// minutes-since-midnight. Returns NaN for unparseable input so the
// caller can fail-open.
function timeToMinutes(t: string): number {
  const parts = t.split(':')
  if (parts.length < 2) return NaN
  const h = Number(parts[0])
  const m = Number(parts[1])
  if (!Number.isFinite(h) || !Number.isFinite(m)) return NaN
  return h * 60 + m
}

// Minutes since local midnight of `now` in `timeZone`.
function localMinutes(now: Date, timeZone: string = QUIET_HOURS_TIME_ZONE): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(now)
  const hour = Number(parts.find((p) => p.type === 'hour')?.value)
  const minute = Number(parts.find((p) => p.type === 'minute')?.value)
  // Some engines render midnight as "24" even with h23; normalise.
  return (hour % 24) * 60 + minute
}

// Test whether `now` falls inside the [quietStart, quietEnd) window, read as
// wall-clock times in `timeZone`. The window may cross midnight (e.g. 22:00 →
// 07:00), in which case "inside" means now >= start OR now < end.
export function isInQuietHours(
  quietStart: string,
  quietEnd: string,
  now: Date,
  timeZone: string = QUIET_HOURS_TIME_ZONE,
): boolean {
  const startMin = timeToMinutes(quietStart)
  const endMin = timeToMinutes(quietEnd)
  if (!Number.isFinite(startMin) || !Number.isFinite(endMin)) return false
  // Equal start/end → empty window (no quiet hours).
  if (startMin === endMin) return false
  const nowMin = localMinutes(now, timeZone)
  if (startMin < endMin) {
    // Same-day window, e.g. 13:00 → 14:00.
    return nowMin >= startMin && nowMin < endMin
  }
  // Crosses midnight, e.g. 22:00 → 07:00.
  return nowMin >= startMin || nowMin < endMin
}
