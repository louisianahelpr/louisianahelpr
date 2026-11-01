/**
 * THE JOB'S NEXT STEP, IN ONE LINE (owner 2026-11-01 12:05 PM): from the one tracker's state (jobProgress), what the
 * viewer does next or who we are waiting on, with the deadline split out ("Next: confirm the job is still on · by Sat
 * 9:00 AM", "Waiting on Yusef to mark it done", "Next: choose a Helpr · 2 applied"). Drawn by <NextStep>
 * (src/components/ui/NextStep.tsx). Read only from the tracker's own words, so the line and the bar never disagree.
 * Guard: src/components/ui/NextStep.test.tsx.
 */
import type { NextStepValue } from "@/components/ui/NextStep";
import type { JobProgressState } from "./jobProgressState";

/** "Confirm you'll be at the job by Wed 9:00 AM" -> the step and "by Wed 9:00 AM". */
const BY_DAY = /^(.*\S) (by (?:Mon|Tue|Wed|Thu|Fri|Sat|Sun)\b.*)$/;

export function jobNextStep(
  progress: JobProgressState,
  o: { side: "poster" | "helpr"; otherFirst?: string | null; pendingApplicants?: number; offerOut?: boolean; noShowRepostedOn?: string | null; approveLeft?: string | null },
): NextStepValue | null {
  const other = (o.otherFirst ?? "").trim();
  // Off the path (cancelled, expired, under review): where it stands, with its word.
  if (progress.stage === null) {
    if (!progress.word && !progress.next) return null;
    return { who: "info", text: progress.next ? `${progress.word} · ${progress.next}` : progress.word };
  }
  // JA-48 / JA-49: an offer or a booking out is not "waiting for Helprs to apply", nor a nameless "with them".
  if (o.side === "poster" && o.offerOut) return { who: "them", text: `Waiting on ${other || "the Helpr"} to accept your offer` };
  if (o.side === "poster" && progress.stage === 0) {
    const n = o.pendingApplicants ?? 0;
    if (n > 0) return { who: "you", text: "Choose a Helpr", by: `${n} applied` };
    // JA-27: a no-show put the job back up; the line says so (the reposted day), never only "Waiting for Helprs".
    if (o.noShowRepostedOn != null) return { who: "info", text: `No-show reported · reposted${o.noShowRepostedOn ? ` ${o.noShowRepostedOn}` : ""}`, by: "waiting for Helprs to apply" };
  }
  // Marked done: the poster's step is the approval, and the review window is IN the line (owner 11-01, live Done-stage
  // screenshot: the countdown was repeated under More options), never a second panel.
  if (o.side === "poster" && progress.stage === 7 && progress.waitingOnYou) {
    return { who: "you", text: `Approve ${other ? `${other}'s` : "your Helpr's"} work`, by: o.approveLeft ?? null };
  }
  // The poster's Working step, before the Helpr marks it done: who the job waits on (unless after photos say more).
  // ("Yusef is at the job" keeps its words: work has not begun, so it is not yet theirs to mark done.)
  if (o.side === "poster" && progress.stage === 6 && !progress.waitingOnYou && / is working$/.test(progress.next)) {
    return { who: "them", text: `Waiting on ${other || "your Helpr"} to mark it done` };
  }
  const line = progress.next.trim();
  if (!line) return null;
  const m = BY_DAY.exec(line);
  const who = progress.waitingOnYou ? "you" : "them";
  return m ? { who, text: m[1], by: m[2] } : { who, text: line };
}
