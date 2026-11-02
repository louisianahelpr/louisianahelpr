import type { MineFaceAction } from "@/components/job-card/MineJobFace";
import { requestFaceAction, takeFaceAction, type CrewFaceRequest } from "@/components/job-card/faceActionRequest";
import { crewMemberStep, crewMinutesUntilDone, type CrewSlot } from "@/lib/crewLifecycle";
import { hasRequiredProof } from "@/lib/photoProofPolicy";

/**
 * A3-33 (audit 11-01): A CREW MEMBER'S OWN STEP IS THE PAGE'S BUTTON.
 *
 * The member's page said "Next: finish and mark it done", but its only button was "See your crew steps": Mark my
 * part done lived on the Working card. This reads the member's roster row through crewMemberStep (the rule the
 * Working card's CrewMemberSection follows) and gives the page that card's own button, in its words: "I'm on my
 * way", "I've arrived", "Mark my part done" (greyed, with the card's note, inside the 30-minute floor), or "Add your
 * photos" while the job needs proof the member has not added. A step opens the Working card and leaves a one-shot
 * request (requestFaceAction) that CrewMemberSection takes when it draws, so its gates (location rationale, the photo
 * proof, the floor, the server's refusals) still decide. A wait (the crew filling, the poster's confirm, a part done)
 * returns null: the page keeps "See your crew steps".
 * Guard: src/test/crewMemberFace.test.ts, JobPage.test.tsx 'A3-33'.
 */
export function crewMemberFace(
  jobId: string,
  slot: CrewSlot | null | undefined,
  job: { status: string | null; require_photo_proof?: boolean | null },
  open: () => void,
  nowMs = Date.now(),
): MineFaceAction | null {
  if (!slot) return null;
  const take = (label: string, request: CrewFaceRequest): MineFaceAction => ({
    label,
    tone: "primary",
    onClick: () => {
      requestFaceAction(jobId, request);
      open();
    },
  });
  switch (crewMemberStep(slot, job.status)) {
    case "set_out":
      return take("I'm on my way", "crew_on_the_way");
    case "arrive":
      return take("I've arrived", "crew_arrived");
    case "finish": {
      if (!hasRequiredProof(job, slot.proof_before_urls, slot.proof_after_urls)) {
        return { label: "Add your photos", tone: "primary", onClick: open };
      }
      const minutesLeft = crewMinutesUntilDone(slot, nowMs);
      if (minutesLeft > 0) {
        return {
          label: "Mark my part done",
          tone: "primary",
          onClick: () => {},
          disabled: true,
          note: `Available in ${minutesLeft} min — 30 minutes after you arrived, to ensure quality.`,
        };
      }
      return take("Mark my part done", "crew_done");
    }
    default:
      return null;
  }
}

/**
 * The Working card's half (CrewMemberSection): the page's request for THIS member's step, taken (once) only while
 * that step is still theirs and its button would be live: on the way while setting out, arrived while on the way,
 * done once the proof is in and the 30-minute floor has passed. Anything else leaves the request to expire.
 */
export function takeCrewFaceRequest(
  jobId: string,
  slot: CrewSlot | null | undefined,
  job: { status: string | null; require_photo_proof?: boolean | null },
  nowMs = Date.now(),
): CrewFaceRequest | null {
  if (!slot) return null;
  const step = crewMemberStep(slot, job.status);
  if (step === "set_out") return takeFaceAction(jobId, "crew_on_the_way") ? "crew_on_the_way" : null;
  if (step === "arrive") return takeFaceAction(jobId, "crew_arrived") ? "crew_arrived" : null;
  if (
    step === "finish" &&
    hasRequiredProof(job, slot.proof_before_urls, slot.proof_after_urls) &&
    crewMinutesUntilDone(slot, nowMs) === 0
  ) {
    return takeFaceAction(jobId, "crew_done") ? "crew_done" : null;
  }
  return null;
}
