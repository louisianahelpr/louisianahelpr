import { useEffect, useState } from "react";
export { doneFloorStart } from "@/lib/doneFloor";

/** The server's completion floor: LEAST(poster_confirmed_working_at,
 *  helper_arrived_at) + 30 min (rpc_helper_mark_done and both completion
 *  triggers, migration *_done_floor_from_arrival). */
const DONE_FLOOR_MS = 30 * 60_000;


/**
 * Is Mark it done still inside its first 30 minutes? Re-renders the
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

/**
 * Whole minutes left on the floor, 0 once it has ended: the "Available in N min" a button says while it is greyed.
 * Counts down while it shows and turns the button on by itself at the end (useDoneFloorActive's own timer).
 */
export function useDoneFloorMinutesLeft(workStartAt: string | null | undefined): number {
  const active = useDoneFloorActive(workStartAt);
  const [, tick] = useState(0);
  useEffect(() => {
    if (!active) return;
    const t = setInterval(() => tick((n) => n + 1), 30_000);
    return () => clearInterval(t);
  }, [active]);
  if (!active || !workStartAt) return 0;
  return Math.max(1, Math.ceil((new Date(workStartAt).getTime() + DONE_FLOOR_MS - Date.now()) / 60_000));
}
