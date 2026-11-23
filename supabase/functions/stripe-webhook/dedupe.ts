// MON-1123-02: what a redelivery does when the dedupe row already exists.
//
// stripe_webhook_events.completed_at (migration 20261123161157) is NULL from
// the moment stripe-webhook inserts its row until the handler returns. A row
// that is still NULL long after it was written belongs to a run that died
// mid-handler (CPU, memory or wall-clock limit, a redeploy): its catch block
// never ran, so it never rolled the row back. Before this, that row answered
// every Stripe retry with 200 "duplicate" and the paid event was lost.

/**
 * How long an unfinished row is presumed to be a run still in flight. Far above
 * the Edge runtime's wall-clock limit (a run cannot still be alive at 10 min),
 * so a takeover never races a live run.
 */
export const STALE_RUN_MS = 10 * 60 * 1000;

export type SeenEvent =
  | { kind: "done" }
  | { kind: "in_flight" }
  | { kind: "takeover" }
  | { kind: "unreadable"; error: unknown };

/** PostgREST / Postgres "no such column" for completed_at (function deployed ahead of its migration). */
export function isMissingCompletedAtColumn(err: unknown): boolean {
  const e = err as { code?: string; message?: string } | null;
  if (!e) return false;
  return (e.code === "PGRST204" || e.code === "42703") && /completed_at/.test(String(e.message ?? ""));
}

// deno-lint-ignore no-explicit-any
type Db = any;

/**
 * The row for `eventId` exists. Claim it if its run died, else say whether it
 * finished or is still running.
 *
 * The claim is ONE conditional UPDATE (unfinished AND older than the stale
 * window), so two redeliveries racing each other cannot both take it over:
 * the second re-checks the WHERE after the first commits, sees the fresh
 * processed_at and matches nothing. Any read or write error is "unreadable",
 * which the caller answers with a 500 (Stripe retries), never a 200.
 */
export async function resolveSeenEvent(supabase: Db, eventId: string, nowMs: number): Promise<SeenEvent> {
  const staleBefore = new Date(nowMs - STALE_RUN_MS).toISOString();
  const { data: claimed, error: claimErr } = await supabase
    .from("stripe_webhook_events")
    .update({ processed_at: new Date(nowMs).toISOString() })
    .eq("event_id", eventId)
    .is("completed_at", null)
    .lt("processed_at", staleBefore)
    .select("event_id");
  if (claimErr) return { kind: "unreadable", error: claimErr };
  if (Array.isArray(claimed) && claimed.length > 0) return { kind: "takeover" };

  const { data: row, error: readErr } = await supabase
    .from("stripe_webhook_events")
    .select("event_id, completed_at")
    .eq("event_id", eventId)
    .maybeSingle();
  if (readErr) return { kind: "unreadable", error: readErr };
  // Gone since the insert collided (a rollback raced us): not processed.
  // "unreadable" -> 500 -> Stripe retries and the insert then succeeds.
  if (!row) return { kind: "unreadable", error: "dedupe row vanished after a unique violation" };
  return row.completed_at ? { kind: "done" } : { kind: "in_flight" };
}
