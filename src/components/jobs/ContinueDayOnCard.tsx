/**
 * A proposed new day that waits on THIS card's viewer, answered ON the card (owner 11-05: "accepting the new day
 * should be on the job card instead, not hidden in the home page"; the owner got "Your Helpr needs another day" and
 * the Posted card had no way to accept it, only the job page did).
 *
 * The rule for who answers is the job page's (continueDayAnswer, src/lib/continueDayWords.ts) and the read is its key
 * (useContinueDay, ["job-continue-day", id]), so the card, the page and Home never disagree. While a proposal waits on
 * the viewer it TAKES the card's one primary and Message steps down to a chip (lead 11-05):
 *   - collapsed: the face's button becomes Confirm / Accept new day with a Message chip beside it, Decline new day as
 *     the text button under it, and the line under it says who asked for which day;
 *   - open: the same answer leads the step row (JobCardLeadContext -> JobStepCard's primary slot, every other primary
 *     stands down, the step's Message chip comes back), with the ask and Decline on the row's note line.
 * The server checks who may answer (answer_job_continue_day). Guard: src/test/continueDayAnswerOnTheCard.test.tsx.
 */
import { useContext, useState } from "react";
import { useNavigate } from "react-router-dom";
import { QueryClientContext } from "@tanstack/react-query";
import { CheckCircle2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { JobStepPrimaryButton } from "@/components/job-card/JobActionRow";
import { useContinueDay } from "@/hooks/useContinueDays";
import { answerContinueDay, continueDayAnswer } from "@/lib/continueDay";
import { userFacingError } from "@/lib/userFacingError";
import type { MineFaceAction } from "@/components/job-card/MineJobFace";
import type { JobCardLead } from "@/components/job-card/jobCardLead";

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
  otherId,
}: {
  job: CardJob | null | undefined;
  side: "poster" | "helpr";
  /** The viewer is this job's poster (Posted) or its hired Helpr (Jobs): nobody else answers. */
  mine: boolean;
  otherFirst: string | null;
  /** The other side's user id, for the Message chip's thread (null: the inbox). */
  otherId: string | null;
}): { faceAction: MineFaceAction | null; lead: JobCardLead | null } {
  // No provider (a card test, the tracker elsewhere): useContinueDay reads nothing, so there is nothing to refresh.
  const qc = useContext(QueryClientContext);
  const navigate = useNavigate();
  const [busy, setBusy] = useState(false);
  const enabled = !!job && mine && job.status === "in_progress" && !job.is_group_job && !job.has_active_dispute;
  const row = useContinueDay(job?.id, enabled);
  const answer = enabled ? continueDayAnswer(row, side) : null;
  if (!job || !row || !answer) return { faceAction: null, lead: null };

  const go = async (accept: boolean) => {
    setBusy(true);
    try {
      await answerContinueDay(row.id, accept);
      toast(accept ? answer.accepted : answer.declined);
      void qc?.invalidateQueries({ queryKey: ["job-continue-day", job.id] });
      void qc?.invalidateQueries({ queryKey: ["job-continue-days"] });
    } catch (err) {
      toast.error(userFacingError(err, "Couldn't save that. Check your connection and try again."));
    } finally {
      setBusy(false);
    }
  };
  const who = (otherFirst ?? "").trim() || (side === "poster" ? "Your Helpr" : "The person who posted it");
  const ask = `${who} asked to finish on ${answer.when}.`;
  const accept = () => void go(true);
  const decline = () => void go(false);
  const message = () => navigate(otherId ? `/messages?jobId=${job.id}&userId=${otherId}` : "/messages");
  const first = (otherFirst ?? "").trim();

  return {
    faceAction: {
      label: busy ? "Saving…" : answer.accept,
      onClick: accept,
      tone: "primary",
      disabled: busy,
      note: row.note ? `${ask} Note: ${row.note}` : ask,
      under: { label: answer.decline, onClick: decline },
      chip: { label: first ? `Message ${first}` : "Message", onClick: message },
    },
    lead: {
      primary: (
        <JobStepPrimaryButton icon={CheckCircle2} label={answer.accept} disabled={busy} onClick={accept} />
      ),
      note: (
        <div data-continue-day-answer="" className="space-y-1">
          <p className="text-ds-13 break-words">{ask}</p>
          {row.note && <p data-continue-day-note="" className="text-ds-13 text-muted-foreground break-words">Note with the new day: {row.note}</p>}
          <Button type="button" variant="link" size="sm" className="h-auto px-0 text-ds-13 font-semibold" disabled={busy} onClick={decline} data-continue-day-decline="">
            {answer.decline}
          </Button>
        </div>
      ),
    },
  };
}
