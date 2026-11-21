/**
 * The poster's words on Jobs > Posted and the job page (design audit Area 03, 11-18: H3, H4, H2, H1, M8, M12). Not on the
 * boot path: the modules that draw them import this file (side effect), which registers the English with t()
 * (enRegistry.ts). Spanish: esJobPoster.ts. Guard: src/test/area03JobsPoster.test.tsx.
 */
import { addEnglish } from "./enRegistry";

export const enJobPoster = {
  // The Posted tab's chips and group headings (POSTED_GROUP_LABEL's words).
  "jp.g.needs_you": "Needs you",
  "jp.g.waiting": "Waiting",
  "jp.g.scheduled": "Upcoming",
  "jp.g.done": "Done",
  "jp.g.cancelled": "Cancelled",
  "jp.all": "All",
  "jp.seeAll": "See all {n}",
  "jp.showLess": "Show less",
  // The card's and the page's buttons.
  "jp.reportNoShow": "Report no-show",
  "jp.postAgain": "Post again",
  "jp.postThisAgain": "Post this job again",
  "jp.messageName": "Message {name}",
  "jp.messageHelpr": "Message your Helpr",
  "jp.payToPost": "Pay to post",
  "jp.seeApplicants": "See applicants ({n})",
  "jp.markDoneRelease": "Mark done and release",
  "jp.approveRelease": "Approve and release",
  "jp.confirmStillOn": "Confirm it's still on",
  "jp.confirmArrived": "Confirm they've arrived",
  "jp.confirming": "Confirming…",
  "jp.changeDate": "Change date or time",
  "jp.applicantOne": "1 applicant",
  "jp.applicantN": "{n} applicants",
  "jp.unpaid": "Not paid yet. Helprs can't see this job until it's paid.",
  "jp.heldLine": "Your card isn't charged until you hire a Helpr.",
  "jp.seeReceipt": "See your receipt",
  // M8: the confirm before "Confirm" arrival on the Posted card.
  "jp.arriveTitle": "Did {name} arrive?",
  "jp.arriveTitleNoName": "Did your Helpr arrive?",
  "jp.arriveBody": "Only confirm once they're at the job.",
  "jp.arriveYes": "Yes, they're here",
  "jp.arriveNo": "Not yet",
  // M12: the applicants list with nobody in it yet.
  "jp.noApplicantsBody": "No one has applied yet. Share the link or boost it to reach more Helprs.",
  // Owner 2026-11-20: the poster's ID check is asked when they send an offer (src/lib/posterIdAtOffer.ts).
  "jp.idAtOffer": "Verify your ID with Stripe before you send an offer. It takes about 2 minutes, once. Then send it again.",
} as const;

addEnglish(enJobPoster);
