/**
 * The job's next-step line's OWN words in English (F260q): the lines jobNextStep.ts builds itself (an offer out,
 * Choose a Helpr, the approval, the Helpr cancelled). One panel's words, imported by jobNextStep.ts only, so they are
 * inlined into its chunk (Q178). The lines it passes through from jobProgressState are still English (HANDOFF-B2 Left).
 * Spanish: esNextStep.ts.
 */
import { addEnglish } from "./enRegistry";

export const enNextStep = {
  "ns.until": "until {when}",
  "ns.by": "by {when}",
  "ns.waitAccept": "Waiting on {name} to accept your offer",
  "ns.theHelpr": "the Helpr",
  "ns.choose": "Choose a Helpr",
  "ns.applied": "{n} applied",
  "ns.noShow": "No-show reported · reposted",
  "ns.noShowOn": "No-show reported · reposted {day}",
  "ns.waitApply": "waiting for Helprs to apply",
  "ns.approveCrew": "Approve your crew's work",
  "ns.approveName": "Approve {name}'s work",
  "ns.approveHelpr": "Approve your Helpr's work",
  "ns.waitDone": "Waiting on {name} to mark it done",
  "ns.yourHelpr": "your Helpr",
  "ns.answerName": "Accept or decline {name}'s offer",
  "ns.answer": "Accept or decline the offer",
  "ns.cancelled": "{name} cancelled",
  "ns.cancelledAt": "{name} cancelled {when}",
  "ns.yourHelprCap": "Your Helpr",
  "ns.openAgain": "Your job is open again, so other Helprs can apply.",
} as const;

addEnglish(enNextStep);
