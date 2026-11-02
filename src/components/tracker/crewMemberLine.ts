/**
 * A3-33 (audit 11-01): A CREW MEMBER'S JOB PAGE SAYS THEIR OWN STEP.
 *
 * The page read the crew from the job row only (confirmed or not): a member who had checked in and waited on the
 * poster read "You're on the crew. Your spot is confirmed · Job time has arrived"; one whose work the poster had
 * already confirmed read "With Dana for approval", because the slot read never selected poster_confirmed_completion_at.
 * This reads the member's OWN roster row (useCrewSlot, CREW_SLOT_COLUMNS) through crewMemberStep, the same rule the
 * member's Working card follows, and says the step in the page's next-step words. Before the member confirms their
 * spot the tracker's own crew line stands (JA-33), so this returns null there.
 * Guard: src/test/crewMemberLine.test.ts.
 */
import type { NextStepValue } from "@/components/ui/NextStep";
import { crewMemberStep, type CrewSlot } from "@/lib/crewLifecycle";

export function crewMemberLine(
  slot: Pick<CrewSlot, "helper_confirmed_at" | "helper_on_the_way_at" | "helper_arrived_at" | "poster_confirmed_arrival_at" | "helper_completed_at"> & { poster_confirmed_completion_at?: string | null } | null | undefined,
  jobStatus: string | null | undefined,
  posterFirst: string | null | undefined,
): NextStepValue | null {
  if (!slot) return null;
  const poster = (posterFirst ?? "").trim() || "the poster";
  switch (crewMemberStep(slot, jobStatus)) {
    case "confirm":
      return null;
    case "waiting_for_crew":
      return { who: "them", text: "You're on the crew. Waiting for the rest of the crew to be hired" };
    case "set_out":
      return { who: "you", text: "Tap I'm on my way when you leave" };
    case "arrive":
      return { who: "you", text: "Tap I've arrived when you get there" };
    case "awaiting_poster":
      return { who: "them", text: `Waiting on ${poster} to confirm you arrived` };
    case "finish":
      return { who: "you", text: "Mark your part done when you finish" };
    case "done":
      return slot.poster_confirmed_completion_at
        ? { who: "info", text: `${poster === "the poster" ? "The poster" : poster} confirmed your work` }
        : { who: "them", text: `You marked your part done. Waiting on ${poster} to confirm your work` };
  }
}
