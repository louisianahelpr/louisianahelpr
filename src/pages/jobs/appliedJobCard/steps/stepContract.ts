import type { ReactNode } from "react";
import type { TrackingData } from "@/components/JobTracking";
import type { AppliedApp, Job } from "../../../../components/job-card/activityConstants";

/**
 * The contract every step of the helper's live job card is handed.
 *
 * One container (ActiveJobSection) owns the state that outlives a step — the
 * abort dialog, the payout unlock timer, whether a revision has been accepted —
 * and hands each step the SAME props. A step therefore cannot invent a new
 * source of truth for "has work started"; it is told.
 */
export interface HelperStepProps {
  app: AppliedApp;
  job: Job & { revision_note?: string | null };
  userId: string;
  initialTracking?: TrackingData | null;
  /** The one tracker element, built once by the container. */
  tracker: ReactNode;
  /** The Message chip, identical in every step — built once, never re-styled. */
  messageChip: ReactNode;
  /** The "Cancel Job" chip — only after the helper has confirmed and before
   *  "I'm On My Way" (owner, 2026-09-14, VN-18); null everywhere else. */
  exitChip: ReactNode;
  /** The "Report a Problem" danger chip for the action row, beside Message
   *  (owner, 2026-09-14, VN-19) — from On the Way onward, i.e. wherever
   *  "Cancel Job" is gone; null where Cancel Job still exists, on a disputed
   *  job, or once the job is done. */
  reportChip: ReactNode;
  /** SOS "share my location" (Q366, TS-007): the Helpr is the party at a
   *  stranger's address. Same rule as the poster's card (`sosOffered`); null
   *  outside it. */
  sosChip: ReactNode;
  /** Rendered after an abort has been taken; replaces the exit. */
  abortedNotice: ReactNode;
}

/** Which step is this card on? One derivation, read by the container only. */
export type HelperStepId = "en_route" | "on_site" | "working" | "submitted" | "revision";

export function deriveHelperStep(args: {
  status: string;
  helperCompletedAt?: string | null;
  workUnderway: boolean;
  hasArrived: boolean;
}): HelperStepId {
  if (args.status === "revision_requested") return "revision";
  if (args.helperCompletedAt) return "submitted";
  if (args.workUnderway) return "working";
  if (args.hasArrived) return "on_site";
  return "en_route";
}
