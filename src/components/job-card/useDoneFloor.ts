import { useEffect, useState } from "react";

/** The server's completion floor: COALESCE(poster_confirmed_working_at,
 *  helper_arrived_at) + 30 min (rpc_helper_mark_done). */
const DONE_FLOOR_MS = 30 * 60_000;

/**
 * Is Mark Job Complete still inside its first 30 minutes? Re-renders the
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
