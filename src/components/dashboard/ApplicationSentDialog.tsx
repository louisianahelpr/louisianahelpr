import { WhatNextSheet } from "@/components/whatNext/WhatNextSheet";
import { formatJobDate } from "@/lib/dateUtils";
import type { EnrichedJob } from "@/components/dashboard/types";
import { JobPriceTakeHome } from "@/components/dashboard/helprTakeHome";

/** What the pop-up reports: the job, and whether the server held the note back. The
 *  poster's name and the job's date are optional: each step leaves out what it lacks. */
export type ApplicationSent = {
  jobId: string;
  title: string | null;
  noteWithheld: boolean;
  posterName?: string | null;
  dateNeeded?: string | null;
  /** The job applied to, for its posted price and the take-home (board 77). */
  job?: EnrichedJob | null;
};

const first = (n: string | null | undefined) => n?.trim().split(/\s+/)[0] || null;

/**
 * AFTER AN APPLY, A POP-UP, NOT A TOAST (owner, 2026-10-08, Q1550), now the shared
 * "What next" sheet (board 77): it went, who decides, and what follows if picked.
 * Money (rust), labelled as a pair (#62, audit 2026-10-21): "Job price $120 · You take
 * home $103", the take-home from useHelprTakeHome — the job page's own computation, so
 * this sheet, the quick view and the job page say one number. It used to print "posted at
 * $120" in the lead and "$103 comes to you" three steps down, from a different path.
 * Without the job, or with no price, both are left out.
 */
export function ApplicationSentDialog({
  sent,
  onClose,
  onView,
}: {
  sent: ApplicationSent | null;
  onClose: () => void;
  onView: (jobId: string) => void;
  /** Kept for callers; the take-home now reads the viewer's tier itself (useHelprTakeHome). */
  platformFee?: number;
}) {
  const job = sent?.job && Number(sent.job.budget) > 0 ? sent.job : null;
  const name = first(sent?.posterName);
  const who = name ?? "The person who posted this job";
  return (
    <WhatNextSheet
      open={!!sent}
      onClose={onClose}
      title="Application sent"
      lead={sent?.title ? <>{who} can now see your application for <strong>{sent.title}</strong>.</> : <>{who} can now see your application.</>}
      steps={[
        { key: "applied", label: "You applied", detail: "Today", state: "done" },
        { key: "pick", label: `${who} picks a Helpr`, detail: "We'll let you know if you're picked", state: "now" },
        { key: "picked", label: name ? `If ${name} picks you` : "If you're picked", detail: "You get the address and can message about the job", state: "later" },
        {
          key: "do",
          label: sent?.dateNeeded ? `Do the job, ${formatJobDate(sent.dateNeeded)}` : "Do the job",
          detail: job ? <><JobPriceTakeHome job={job} />, paid once it's confirmed done</> : "Then you're paid once it's confirmed done",
          state: "later",
        },
      ]}
      primary={{ label: "Got it", acknowledge: true }}
      secondary={{ label: "See the job", onClick: () => { if (sent) onView(sent.jobId); onClose(); } }}
    >
      {sent?.noteWithheld ? (
        <p className="mt-3 rounded-xl border border-border bg-muted/40 p-3 text-ds-13 text-foreground">
          Your note wasn't included: it looked like contact or payment details, which can't be shared
          before a job is confirmed. They see your application without it.
        </p>
      ) : null}
    </WhatNextSheet>
  );
}
