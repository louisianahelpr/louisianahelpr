/**
 * The deal room's step notes, tip pills and receipt in English (F260q): jobSystemEvents.ts builds them, so it is this
 * file's one importer (inlined into its chunk, Q178); SystemEventRow and ChatReceiptCard draw only what it built.
 * Importing this file registers the words with t() (enRegistry.ts). Spanish: esChatEvents.ts.
 */
import { addEnglish } from "./enRegistry";

export const enChatEvents = {
  "ce.yourHelpr": "Your Helpr",
  "ce.thePoster": "The person who posted it",
  "ce.onWay": "{name} is on the way.",
  "ce.youOnWay": "You're on the way.",
  "ce.arrived": "{name} arrived.",
  "ce.youArrived": "You arrived.",
  "ce.done": "{name} marked it done.",
  "ce.youDone": "You marked it done.",
  "ce.approved": "{name} approved it.",
  "ce.youApproved": "You approved it.",
  "ce.fix": "{name} asked for a fix.",
  "ce.youFix": "You asked for a fix.",
  "ce.cancelledByPoster": "Job cancelled by the person who posted it.",
  "ce.cancelledByHelpr": "Job cancelled by the Helpr.",
  "ce.cancelled": "Job was cancelled.",
  "ce.disputePoster": "The person who posted this job opened a dispute.",
  "ce.disputeHelpr": "The Helpr opened a dispute.",
  "ce.dispute": "A dispute was opened.",
  "ce.youTipped": "You tipped {amount}",
  "ce.tipped": "{name} tipped {amount}",
  "ce.they": "They",
  "ce.job": "Job",
  "ce.urgent": "Urgent bonus",
  "ce.tax": "Tax",
  "ce.setupFee": "Account setup fee",
  "ce.tip": "Tip",
  "ce.receipt": "Receipt",
  "ce.total": "Total",
  "ce.update": "System update: {label}",
} as const;

addEnglish(enChatEvents);
