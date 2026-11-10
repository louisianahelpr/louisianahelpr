import { useState } from "react";
import { PosterFinishSheet } from "@/components/jobs/PosterFinishSheet";
import { continueDayMissedOpen } from "@/lib/continueDayMissed";
import { POSTER_FINISH_LABEL, posterFinishOpen, type PosterFinishDay, type PosterFinishJob } from "../../../../supabase/functions/_shared/posterFinish";
import type { PagePrimary } from "./posterPageActions";
import type { PosterPageFlows } from "./usePosterPageFlows";

/**
 * THE POSTER'S "MARK DONE AND RELEASE" ON THE JOB PAGE (owner 11-10, her job "Mow and Weed Eat" 7b1da54b showed only
 * "Change day" and "Message" after its continue day passed with no done from the Helpr).
 *
 * Offered while posterFinishOpen says so (the job page's mirror of the server's poster_finish_job_refusal): in
 * progress, one Helpr, money held, no done from the Helpr, no case open, and the day it was set for (its open continue
 * day's, else the job's own) has started. It leads the row; its confirm (PosterFinishSheet) names the amount, and the
 * release is the Posted card's own completeJob with `posterFinishes` (usePosterPageFlows.finish). Never while a refund
 * request waits (that panel is the next step, Q2694).
 * Guard: src/pages/jobs/jobPage/JobPage.test.tsx ("Yusef's job: the set day passed").
 */
export function usePosterFinish({
  job,
  enabled,
  day,
  helperFirst,
  flows,
  refundOpen,
}: {
  job: (PosterFinishJob & { title: string; budget?: number | null; urgent_fee?: number | null }) | null | undefined;
  /** The poster only. */
  enabled: boolean;
  /** The job's open continue day (useContinueDayActions' row). */
  day: PosterFinishDay;
  helperFirst: string | null;
  flows: PosterPageFlows;
  refundOpen: boolean;
}): { lead: PagePrimary | null; sheet: React.ReactNode } {
  const [open, setOpen] = useState(false);
  if (!enabled || !job || refundOpen || !posterFinishOpen(job, day)) return { lead: null, sheet: null };
  // The approve sheet's rule (InProgressStep): the job price is the whole release only with no rush fee.
  const jobPrice = !(job.urgent_fee && job.urgent_fee > 0) && job.budget ? Number(job.budget) : null;
  const onContinueDay = !!day && (day.status === "set" || day.status === "proposed");
  return {
    lead: { label: POSTER_FINISH_LABEL, go: () => setOpen(true), disabled: !flows.ready || flows.completing },
    sheet: (
      <PosterFinishSheet
        open={open}
        onOpenChange={setOpen}
        jobTitle={job.title}
        helperFirst={helperFirst}
        jobPrice={jobPrice}
        onContinueDay={onContinueDay}
        missedOffered={!!day && day.status === "set" && continueDayMissedOpen({ status: day.status, new_date: day.new_date ?? "", new_start_time: day.new_start_time }, job.helper_completed_at)}
        busy={flows.completing}
        onConfirm={() => { setOpen(false); flows.finish(); }}
      />
    ),
  };
}
