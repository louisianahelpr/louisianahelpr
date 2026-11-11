/** "23h 52m left, then Helpr support steps in", or, once the window passed, that support reaches out. */
export function reviewTimeLeft(deadlineMs: number, now = Date.now()): string {
  const ms = deadlineMs - now;
  // F273: past the window the poster can still approve (the admin alert closes itself on approval, 20261023143240),
  // so the line says so, never a bare "24 hours passed" that read as too late.
  if (ms <= 0) return "You can still approve. Helpr support will check in; your payment stays held";
  const mins = Math.floor(ms / 60_000);
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return `${h > 0 ? `${h}h ${m}m` : `${m}m`} left, then Helpr support steps in`;
}
