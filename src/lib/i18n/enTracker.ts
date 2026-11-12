/**
 * The job tracker's step button in English (F260q, owner 11-11 "Spanish everything"): the ACTION each next step is
 * named by (STATUSES' action in trackerSteps.ts: "I'm on my way", "I've arrived", ...) and the retry after a refused
 * arrival. Its own small chunk (vite.config.ts I18N_SCREEN_DICTS), loaded with the tracker (JobTrackingView), never on
 * boot. trackerSteps.ts keeps the English (other screens and tests read it). Spanish: esTracker.ts.
 */
import { addEnglish } from "./enRegistry";

export const enTracker = {
  "trk.act.confirmed": "I've accepted",
  "trk.act.job_confirmed": "Confirm this job",
  "trk.act.on_the_way": "I'm on my way",
  "trk.act.arrived": "I've arrived",
  "trk.act.working": "Start working",
  "trk.act.done": "Mark it done",
  "trk.retryLocation": "Try my location again",
} as const;

addEnglish(enTracker);
