/**
 * Declutter's public questions on an item in English (F260q, owner 11-11 "Spanish everything"): the list, the Ask box,
 * the seller's Answer sheet (DeclutterQuestions.tsx). Importing this file registers the words with t() (enRegistry.ts).
 */
import { addEnglish } from "./enRegistry";

export const enQuestions = {
  "dq.today": "today",
  "dq.yesterday": "yesterday",
  "dq.daysAgo": "{n} days ago",
  "dq.yourQuestion": "Your question",
  "dq.askedByNeighbor": "Asked by a neighbor",
  "dq.yourQuestionAsked": "Your question · asked",
  "dq.asked": "Asked",
  "dq.relistToAnswer": "relist it to answer",
  "dq.waitingForYou": "waiting for your answer",
  "dq.waitingFor": "waiting for {name}",
  "dq.theSeller": "the seller",
  "dq.answer": "Answer",
  "dq.reportQuestion": "Report question",
  "dq.reportAnswer": "Report answer",
  "dq.answerPosted": "Answer posted.",
  "dq.answerPublicly": "Answer publicly",
  "dq.yourAnswer": "Your answer",
  "dq.everyoneSeesAnswer": "Everyone viewing the item sees this.",
  "dq.postAnswer": "Post answer",
  "dq.questionPosted": "Question posted. The answer will show here.",
  "dq.heading": "Questions ({n})",
  "dq.loadFailed": "We couldn't load the questions.",
  "dq.none": "No questions yet.",
  "dq.askLabel": "Ask a question",
  "dq.placeholder": "Ask about size, condition…",
  "dq.ask": "Ask",
  "dq.rules": "Everyone can see questions and answers. Contact info is not allowed.",
  "dq.wantDeal": " Want to make a deal? ",
  "dq.makeOffer": "Make an offer",
  "dq.wantDealPlain": " Want to make a deal? Make an offer.",
  "dq.previewNote": "Buyers ask here. You'll get a notice and answer from this page.",
} as const;

addEnglish(enQuestions);
