/**
 * The Home To-do / Next up lines' own words in English (F260q, owner 11-11 "Spanish everything"): the side words
 * ("You hired", "You're on the way"), the buttons, "Review 3 applicants", the shop order line and the "· by Mon 8:00 AM"
 * / "· 2h 5m left" tails (needsYouTodos.ts, which loads beside the data, B51). The step sentences themselves come from
 * the job tracker (jobNextStep / jobStatusLine) and Declutter's to-dos, still English. Spanish: esTodos.ts.
 */
import { addEnglish } from "./enRegistry";

export const enTodos = {
  "todo.answerOrderFor": "Answer an order for {title}",
  "todo.answerOrder": "Answer an order for your shop",
  "todo.shopMeta": "Your shop · waiting for your answer",
  "todo.answerOrderAction": "Answer order",
  "todo.reviewOne": "Review 1 applicant",
  "todo.reviewN": "Review {n} applicants",
  "todo.youHired": "You hired",
  "todo.youPosted": "You posted",
  "todo.youApplied": "You applied",
  "todo.onTheWay": "You're on the way",
  "todo.working": "You're working",
  "todo.hired": "You're hired",
  "todo.seeApplicants": "See applicants",
  "todo.reviewWork": "Review work",
  "todo.openJob": "Open job",
  "todo.onTheWayTask": "Tap I've arrived when you get there",
  "todo.arrived": "I've arrived",
  "todo.left": "{task} · {time} left",
  "todo.by": "{task} · by {day}",
} as const;

addEnglish(enTodos);
