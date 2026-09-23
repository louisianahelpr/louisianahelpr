/**
 * Cold-launch phase markers, buffered until Sentry is loaded (Q178).
 *
 * useAuthReady used to `import("@/lib/sentry")` the moment auth settled, just
 * to drop an "auth-ready-resolved" breadcrumb. That dynamic import fetched the
 * whole 69 KB (gzip) Sentry SDK in the middle of a cold load — measured on the
 * landing at 375 on a slow connection, it downloaded alongside the page's own
 * chunk — although main.tsx defers Sentry until the first interaction on
 * purpose, and the breadcrumb was then DROPPED anyway: markColdLaunchPhase()
 * returns early while Sentry is not initialised, which at that moment it never
 * is.
 *
 * Now the phase is recorded here (no dependencies, costs nothing) with its
 * real timestamp, and sentry.ts replays the buffer when it initialises, so the
 * breadcrumb survives and nothing is fetched early.
 */
type Sink = (phase: string, timestampSeconds: number) => void;

const pending: Array<{ phase: string; at: number }> = [];
let sink: Sink | null = null;

export function recordColdLaunchPhase(phase: string): void {
  const at = Date.now() / 1000;
  if (sink) sink(phase, at);
  else if (pending.length < 20) pending.push({ phase, at });
}

/** Called by sentry.ts once initialised: replays the buffer, then goes live. */
export function attachColdLaunchSink(next: Sink): void {
  sink = next;
  for (const { phase, at } of pending.splice(0)) next(phase, at);
}
