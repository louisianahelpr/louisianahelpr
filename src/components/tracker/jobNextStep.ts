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

/** "Mon 6:00 AM" in Louisiana time (the tracker's own format, jobProgressState `when`). */
function laTime(ms: number): string {
  return new Date(ms).toLocaleString("en-US", { timeZone: "America/Chicago", weekday: "short", hour: "numeric", minute: "2-digit" });
}

export function jobNextStep(
  progress: JobProgressState,
  o: { side: "poster" | "helpr"; otherFirst?: string | null; pendingApplicants?: number; offerOut?: boolean; offerUntil?: string | null; noShowRepostedOn?: string | null; approveLeft?: string | null; crew?: boolean },
): NextStepValue | null {
  const other = (o.otherFirst ?? "").trim();
  // Off the path (cancelled, expired, under review): where it stands, with its word.
  if (progress.stage === null) {
    if (!progress.word && !progress.next) return null;
    const off: NextStepValue = { who: "info", text: progress.next ? `${progress.word} · ${progress.next}` : progress.word };
    return progress.next && progress.body ? { ...off, body: progress.body } : off;
  }
  // JA-48 / JA-49: an offer or a booking out is not "waiting for Helprs to apply", nor a nameless "with them".
  // JA-49 (lead 11-01, B107): the offered Helpr by name and until when the offer stands (jobs.direct_offer_expires_at).
  if (o.side === "poster" && o.offerOut) {
    const untilMs = Date.parse(o.offerUntil ?? "");
    const by = Number.isNaN(untilMs) || untilMs <= Date.now() ? null : `until ${laTime(untilMs)}`;
    return { who: "them", text: `Waiting on ${other || "the Helpr"} to accept your offer`, by };
  }
  if (o.side === "poster" && progress.stage === 0) {
    const n = o.pendingApplicants ?? 0;
    if (n > 0) return { who: "you", text: "Choose a Helpr", by: `${n} applied` };
    // JA-27: a no-show put the job back up; the line says so (the reposted day), never only "Waiting for Helprs".
    if (o.noShowRepostedOn != null) return { who: "info", text: `No-show reported · reposted${o.noShowRepostedOn ? ` ${o.noShowRepostedOn}` : ""}`, by: "waiting for Helprs to apply" };
  }
  // Marked done: the poster's step is the approval, and the review window is IN the line (owner 11-01, live Done-stage
  // screenshot: the countdown was repeated under More options), never a second panel.
  if (o.side === "poster" && progress.stage === 7 && progress.waitingOnYou) {
    // A3-32 (audit 11-01): a crew's approval is plural.
    return { who: "you", text: `Approve ${o.crew ? "your crew's" : other ? `${other}'s` : "your Helpr's"} work`, by: o.approveLeft ?? null };
  }
  // The poster's Working step, before the Helpr marks it done: who the job waits on (unless after photos say more).
  // ("Yusef is at the job" keeps its words: work has not begun, so it is not yet theirs to mark done.)
  if (o.side === "poster" && progress.stage === 6 && !progress.waitingOnYou && / is working$/.test(progress.next)) {
    return { who: "them", text: `Waiting on ${other || "your Helpr"} to mark it done` };
  }
  const line = progress.next.trim();
  if (!line) return null;
  // Q2601 (Jobs audit 1102b row 15): "Next: Lexi offered you this job" is news, not a step. The step is the answer,
  // with who offered it and the offer's own clock when the page has it.
  if (o.side === "helpr" && progress.waitingOnYou && / offered you this job$/.test(line)) {
    const untilMs = Date.parse(o.offerUntil ?? "");
    return { who: "you", text: `Accept or decline ${other ? `${other}'s` : "the"} offer`, by: Number.isNaN(untilMs) || untilMs <= Date.now() ? null : `by ${laTime(untilMs)}` };
  }
  const m = BY_DAY.exec(line);
  const who = progress.waitingOnYou ? "you" : "them";
  // Q2590 (Jobs audit 1102b row 4): "Next: lexi offered you this job" lost the name's capital; a line that starts
  // with the other person's name keeps it.
  const keepCase = !!other && (line === other || line.startsWith(`${other} `) || line.startsWith(`${other}'`));
  const v: NextStepValue = m ? { who, text: m[1], by: m[2] } : { who, text: line };
  // Q2600: the line's explanation (a dispute's "who decides and when") is body text under it, never in the bold line.
  if (progress.body) v.body = progress.body;
  return keepCase ? { ...v, keepCase } : v;
}
