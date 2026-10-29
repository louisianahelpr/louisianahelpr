/**
 * "Need it today" and the day picker, together (A2-C27, app audit 2026-10-28).
 * The start "Need it today" fills in is for TODAY only (now + 2 hours'
 * notice, sameDayJob.ts). Moving the job to another day used to keep that
 * start silently (Review: "Sat, Oct 31 · 3:00 AM"); now a start that is still
 * the one "Need it today" set is cleared when another day is picked, so the
 * poster picks a start for that day (the form asks for one). A start the
 * poster chose themselves is always kept.
 */
import { useRef } from "react";
import { sameDayStartTime } from "@/lib/sameDayJob";

export function useSameDayPick({ today, startTime, setDateNeeded, setStartTime }: {
  today: string;
  startTime: string;
  setDateNeeded: (v: string) => void;
  setStartTime: (v: string) => void;
}) {
  const setByToday = useRef<string | null>(null);
  return {
    sameDayStart: sameDayStartTime(),
    /** "Need it today"'s start, remembered as its own. */
    markTodayStart: (start: string) => {
      setByToday.current = start;
      setStartTime(start);
    },
    pickDay: (iso: string) => {
      setDateNeeded(iso);
      if (iso === today) return;
      if (setByToday.current !== null && startTime === setByToday.current) setStartTime("");
      setByToday.current = null;
    },
  };
}
