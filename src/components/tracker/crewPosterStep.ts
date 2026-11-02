/**
 * A3-32 (audit 11-01): THE POSTER'S CREW LINE NAMES THE NEXT STEP, FROM THE ROSTER.
 *
 * A crew's job row carries no one Helpr's stamps, so the tracker's line for a crew said "Your crew is booked. Each
 * Helpr's step is under Your crew", then "Waiting on your crew to finish" while a member's Confirm work sat on the
 * poster, then "approve your Helpr's work" (singular). The roster holds each member's own stamps; this reads them in
 * the order the poster must act:
 *   1. a member arrived and is not confirmed       -> "Confirm Yusef arrived"           (the roster's Confirm arrived)
 *   2. a member marked their part done, not checked -> "Confirm Yusef's work"            (the roster's Confirm work)
 *   3. before the start, a member has not confirmed -> "Waiting on Marcus to confirm their spot · by <start>"
 * Otherwise null, and the tracker keeps its own words. Drawn by <NextStep> through JobTracker's step override.
 * Guard: src/test/crewPosterStep.test.ts.
 */
import type { NextStepValue } from "@/components/ui/NextStep";
import { slotLabel } from "./jobProgressState";
import { jobStartDateTime } from "@/lib/dateUtils";

export interface CrewRosterRow {
  helper_id: string | null;
  status: string;
  helper_confirmed_at?: string | null;
  helper_arrived_at?: string | null;
  poster_confirmed_arrival_at?: string | null;
  helper_completed_at?: string | null;
  poster_confirmed_completion_at?: string | null;
}

export function crewPosterStep(
  roster: readonly CrewRosterRow[] | null | undefined,
  names: Readonly<Record<string, string>>,
  job: { date_needed?: string | null; start_time?: string | null },
  now: number = Date.now(),
): NextStepValue | null {
  const hired = (roster ?? []).filter((r) => r.status === "accepted");
  if (hired.length === 0) return null;
  const first = (r: CrewRosterRow) => ((r.helper_id ? names[r.helper_id] : "") ?? "").trim().split(/\s+/)[0] || "a Helpr";
  const arrived = hired.find((r) => r.helper_arrived_at && !r.poster_confirmed_arrival_at && !r.helper_completed_at);
  if (arrived) return { who: "you", text: `Confirm ${first(arrived)} arrived` };
  const done = hired.find((r) => r.helper_completed_at && !r.poster_confirmed_completion_at);
  if (done) {
    const n = first(done);
    return { who: "you", text: n === "a Helpr" ? "Confirm your Helpr's work" : `Confirm ${n}'s work` };
  }
  const start = job.date_needed ? jobStartDateTime(job.date_needed, job.start_time ?? null) : null;
  const unconfirmed = hired.find((r) => !r.helper_confirmed_at);
  if (unconfirmed && start && now < start.getTime()) {
    return { who: "them", text: `Waiting on ${first(unconfirmed)} to confirm their spot`, by: `by ${slotLabel(job.date_needed, job.start_time)}` };
  }
  return null;
}
