import { createContext, type ReactNode } from "react";

/**
 * A question the CARD has for its viewer that outranks whatever the open step would lead with (owner 11-05: "accepting
 * the new day should be on the job card instead, not hidden"; lead 11-05: it takes the card's ONE primary and Message
 * steps down to a chip). The card provides it; the JobStepCard it mounts draws `primary` in the row's primary slot and
 * `note` on the row's note line, and every other primary / note claim on that row stands down while it is set
 * (JobStepRowSlot `lead`). Null = nothing outranks the step. Guard: src/test/continueDayAnswerOnTheCard.test.tsx.
 */
export interface JobCardLead {
  primary: ReactNode;
  note: ReactNode;
}

export const JobCardLeadContext = createContext<JobCardLead | null>(null);
