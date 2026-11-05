/**
 * A proposed new day that waits on THIS card's viewer, answered ON the card (owner 11-05: "accepting the new day
 * should be on the job card instead, not hidden in the home page"; the owner got "Your Helpr needs another day" and
 * the Posted card had no way to accept it, only the job page did).
 *
 * The rule for who answers is the job page's (continueDayAnswer, src/lib/continueDayWords.ts) and the read is its key
 * (useContinueDay, ["job-continue-day", id]), so the card, the page and Home never disagree. While a proposal waits on
 * the viewer:
 *   - collapsed: the face's ONE button becomes Confirm / Accept new day, with Decline new day as the text button under
 *     it, and the line under it says who asked for which day;
 *   - open: the same question, its note and both answers sit at the top of the card body.
 * The server checks who may answer (answer_job_continue_day). Guard: src/test/continueDayAnswerOnTheCard.test.tsx.
 */
import { useState, type ReactNode } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { useContinueDay } from "@/hooks/useContinueDays";
import { answerContinueDay, continueDayAnswer } from "@/lib/continueDay";
import { userFacingError } from "@/lib/userFacingError";
import type { MineFaceAction } from "@/components/job-card/MineJobFace";

type CardJob = {
  id: string;
  status: string | null;
  is_group_job?: boolean | null;
  has_active_dispute?: boolean | null;
};

export function useContinueDayOnCard({
  job,
  side,
  mine,
  otherFirst,
}: {
  job: CardJob | null | undefined;
  side: "poster" | "helpr";
  /** The viewer is this job's poster (Posted) or its hired Helpr (Jobs): nobody else answers. */
  mine: boolean;
  otherFirst: string | null;
}): { faceAction: MineFaceAction | null; block: ReactNode } {
  const qc = useQueryClient();
  const [busy, setBusy] = useState(false);
  const enabled = !!job && mine && job.status === "in_progress" && !job.is_group_job && !job.has_active_dispute;
  const row = useContinueDay(job?.id, enabled);
  const answer = enabled ? continueDayAnswer(row, side) : null;
  if (!job || !row || !answer) return { faceAction: null, block: null };

  const go = (accept: boolean) => async () => {
    setBusy(true);
    try {
      await answerContinueDay(row.id, accept);
      toast(accept ? answer.accepted : answer.declined);
      void qc.invalidateQueries({ queryKey: ["job-continue-day", job.id] });
      void qc.invalidateQueries({ queryKey: ["job-continue-days"] });
    } catch (err) {
      toast.error(userFacingError(err, "Couldn't save that. Check your connection and try again."));
    } finally {
      setBusy(false);
    }
  };
  const who = (otherFirst ?? "").trim() || (side === "poster" ? "Your Helpr" : "The person who posted it");
  const ask = `${who} asked to finish on ${answer.when}.`;
  const accept = () => void go(true)();
  const decline = () => void go(false)();

  return {
    faceAction: {
      label: busy ? "Saving…" : answer.accept,
      onClick: accept,
      tone: "primary",
      disabled: busy,
      note: row.note ? `${ask} Note: ${row.note}` : ask,
      under: { label: answer.decline, onClick: decline },
    },
    block: (
      <div data-continue-day-answer="" className="space-y-2 rounded-ds-sm border border-border px-3 py-2.5" onClick={(e) => e.stopPropagation()}>
        <p className="font-sans text-ds-14 font-semibold break-words">{ask}</p>
        {row.note && <p data-continue-day-note="" className="text-ds-13 text-muted-foreground break-words">Note with the new day: {row.note}</p>}
        <div className="flex flex-wrap gap-2">
          <Button type="button" size="sm" disabled={busy} onClick={accept} data-continue-day-accept="">{answer.accept}</Button>
          <Button type="button" size="sm" variant="outline" disabled={busy} onClick={decline} data-continue-day-decline="">{answer.decline}</Button>
        </div>
      </div>
    ),
  };
}
