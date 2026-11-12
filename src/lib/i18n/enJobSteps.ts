/**
 * The job tracker's step names and its spoken sentence in English (F260q): JobProgress.tsx (Home, the job page, chat,
 * job cards, /payment-success). One panel's words, imported by that panel only, so they are inlined into its chunk
 * (Q178). The names equal JOB_PROGRESS_STEPS / JOB_PROGRESS_DRAWN (soft hyphens included) word for word; the guard
 * src/test/jobStepsInSpanish.test.tsx holds them equal. Spanish: esJobSteps.ts.
 */
import { addEnglish } from "./enRegistry";

export const enJobSteps = {
  "js.s.0": "Posted",
  "js.s.1": "Offered",
  "js.s.2": "Hired",
  "js.s.3": "Confirmed",
  "js.s.4": "On the way",
  "js.s.5": "Arrived",
  "js.s.6": "Working",
  "js.s.7": "Done",
  "js.d.0": "Post­ed",
  "js.d.1": "Of­fered",
  "js.d.2": "Hired",
  "js.d.3": "Con­firmed",
  "js.d.4": "On the way",
  "js.d.5": "Ar­rived",
  "js.d.6": "Work­ing",
  "js.d.7": "Done",
  "js.cancelled": "Cancelled",
  "js.aria.cancelled": "Job progress: {label}. No steps ahead.",
  "js.aria.allDone": "Job progress: all {n} steps done ({steps}).",
  "js.aria.at": "Job progress, step {at} of {n}: {step}, {where}.",
  "js.aria.atWord": "Job progress, step {at} of {n}: {step} ({label}), {where}.",
  "js.aria.needs": "needs attention",
  "js.aria.needsWord": "{label}, needs attention",
  "js.aria.you": "waiting on you",
  "js.aria.them": "waiting on the other person",
  "js.aria.done": "Done: {steps}.",
  "js.aria.later": "Still to come: {steps}.",
} as const;

addEnglish(enJobSteps);
