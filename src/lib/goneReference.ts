/**
 * True when a write failed because a row it points at no longer exists
 * (Postgres 23503, foreign_key_violation).
 *
 * The inbox's per-thread stores (thread_pins, thread_archives) keep a local
 * mirror keyed by job id and replay it to the server. A job can be deleted
 * after the device cached it (every thread_* table cascades on jobs delete),
 * so that write can never succeed: it is not a fault to report, and retrying
 * it forever just repeats the error on every inbox load. Sentry JAVASCRIPT-2K
 * (2026-09-25, and three error_logs rows on 2026-09-09) was exactly this.
 *
 * Only 23503 counts. Every other error still reaches `report()`: this is a
 * deliberate, named exception, not a way to quiet a write.
 */
export function isGoneReference(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  return (error as { code?: string }).code === "23503";
}
