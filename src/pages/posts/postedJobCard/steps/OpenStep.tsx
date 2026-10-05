import { Rocket, Pencil, XCircle } from "lucide-react";
import { JobStepCard } from "@/components/job-card/JobStepCard";
import { JobActionChip, JOB_ACTION_CHIP_CLASS, jobActionChipStyle } from "../../../../components/job-card/JobActionRow";
import { ShareJobButton } from "@/components/jobs/ShareJobButton";
import DeadlineCountdown from "@/components/job-card/DeadlineCountdown";
import { posterDeadline } from "@/components/job-card/jobStatusLine";
import type { PosterStepCtx } from "./posterStepContract";

/**
 * POSTER STEP 1 — open, nobody hired yet.
 *
 * No ask and no primary: applicants are the primary, and they are rendered
 * above this by PostedJobApplicants. What this step owns is the four levers —
 * Cancel, Share, Boost, Edit.
 *
 * CANCEL LEADS, IT NO LONGER TRAILS (owner, 2026-09-19). The original order
 * was Share · Boost · Edit · Cancel, and its reasoning is worth keeping rather
 * than deleting: "least destructive first, Cancel last so the one irreversible
 * action is furthest from the thumb". The owner reversed it — the rule across
 * the app is now that the most-primary control takes the RIGHT-most slot and a
 * destructive one never does, which is what every other row on these cards
 * already does (InProgressStep: "danger left, Message middle, Approve right").
 * This row has no green primary of its own, so what the reversal costs is only
 * Cancel's position: it moves to the far left, where every other danger
 * control on a step card sits, and the remaining three keep their order.
 *
 * The boost banner is a NOTICE (it states a fact and offers nothing), which is
 * why it is no longer a `mb-2` div hand-spaced above the row.
 */
export function OpenStep({ job, onBoost, onEdit, onCancel, crewBooked }: PosterStepCtx) {
  const boostExp = job.boost_expires_at ? new Date(job.boost_expires_at) : null;
  const isBoosted = !!boostExp && boostExp > new Date();
  // A pending direct offer runs on a clock; the collapsed line shows it, so
  // the expanded step does too (owner, 2026-10-01: every tracker deadline).
  const offerClock = job.direct_offer_status === "pending" ? posterDeadline("offer_out", job) : null;

  return (
    <JobStepCard
      side="poster"
      step="open"
      notice={
        offerClock || (isBoosted && boostExp) ? (
          <>
          {offerClock && (
            <DeadlineCountdown
              inline
              deadline={offerClock.at}
              expiredText={offerClock.expiredText}
              consequenceText={offerClock.consequenceText}
            />
          )}
          {isBoosted && boostExp && (
          <div
            className="rounded-ds-md px-3 py-2 flex items-center gap-2"
            style={{
              background: "hsl(var(--gold-warm) / 0.10)",
              border: "0.5px solid hsl(var(--gold-warm) / 0.32)",
            }}
          >
            <Rocket className="w-3.5 h-3.5 shrink-0" style={{ color: "hsl(var(--gold-warm))" }} strokeWidth={2.25} />
            <p className="font-sans leading-snug text-ds-12" style={{ color: "hsl(var(--olivewood) / 0.85)" }}>
              <span className="font-sans font-bold" style={{ color: "hsl(var(--ink-deep))" }}>
                Boosted until {boostExp.toLocaleString("en-US", { weekday: "short", hour: "numeric", minute: "2-digit" })}.
              </span>{" "}
              Re-boost available after expiry.
            </p>
          </div>
          )}
          </>
        ) : null
      }
      actions={[
        <JobActionChip key="cancel" icon={XCircle} label="Cancel" ariaLabel="Cancel job" tone="danger" onClick={() => onCancel(job)} />,
        <ShareJobButton
          key="share"
          job={{ id: job.id, title: job.title, budget: job.budget, category: job.category }}
          layout="stack"
          className={JOB_ACTION_CHIP_CLASS}
          style={jobActionChipStyle("share")}
        />,
        <JobActionChip
          key="boost"
          icon={Rocket}
          label={isBoosted ? "Boosted" : "Boost"}
          tone="boost"
          disabled={isBoosted}
          onClick={() => onBoost(job.id)}
        />,
        // Q707 (owner, 2026-10-05): a crew stays open while it fills, but once a
        // member is hired its date and details change only through a request
        // the crew accepts (Q1254), and the server refuses a direct edit.
        ...(crewBooked
          ? []
          : [<JobActionChip key="edit" icon={Pencil} label="Edit" ariaLabel="Edit job" tone="edit" onClick={() => onEdit(job)} />]),
      ]}
    />
  );
}
