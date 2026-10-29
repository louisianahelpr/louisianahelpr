import { useEffect, useState } from "react";

/** The server's completion floor: LEAST(poster_confirmed_working_at,
 *  helper_arrived_at) + 30 min (rpc_helper_mark_done and both completion
 *  triggers, migration *_done_floor_from_arrival). */
const DONE_FLOOR_MS = 30 * 60_000;

/**
 * When the 30-minute floor starts: the EARLIER of the Helpr's arrival and the
 * poster's "Confirm they're working", ignoring a missing one (SQL LEAST). The
 * poster's confirm comes after the Helpr starts working, so in practice this is
 * the arrival: a late confirm never restarts the clock (audit 2026-10-28 F12).
 * Null when neither is stamped (no floor). Every client copy reads this.
 */
export function doneFloorStart(posterConfirmedWorkingAt: string | null | undefined, arrivedAt: string | null | undefined): string | null {
  const stamps = [posterConfirmedWorkingAt, arrivedAt].filter((t): t is string => !!t && Number.isFinite(Date.parse(t)));
  if (stamps.length === 0) return null;
  return stamps.reduce((a, b) => (Date.parse(b) < Date.parse(a) ? b : a));
}

/**
 * Is Mark job complete still inside its first 30 minutes? Re-renders the
 * moment the floor ends, so the greyed button turns on by itself (owner,
 * 2026-10-08: "mark job complete should be greyed out until its available in
 * the 30 min"; "if it's greyed then no toast is needed").
 */
export function useDoneFloorActive(workStartAt: string | null | undefined): boolean {
  const unlocksAt = workStartAt ? new Date(workStartAt).getTime() + DONE_FLOOR_MS : null;
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (unlocksAt === null) return;
    const wait = unlocksAt - Date.now();
    if (wait <= 0) { setNow(Date.now()); return; }
    const t = setTimeout(() => setNow(Date.now()), wait + 250);
    return () => clearTimeout(t);
  }, [unlocksAt]);
  return unlocksAt !== null && now < unlocksAt;
}
