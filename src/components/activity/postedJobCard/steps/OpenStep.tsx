import { Rocket, Pencil, XCircle } from "lucide-react";
import { JobStepCard } from "@/components/activity/JobStepCard";
import { JobActionChip, JOB_ACTION_CHIP_CLASS, jobActionChipStyle } from "../../JobActionRow";
import { ShareJobButton } from "@/components/jobs/ShareJobButton";
import type { PosterStepCtx } from "./posterStepContract";

/**
 * POSTER STEP 1 — open, nobody hired yet.
 *
 * No ask and no primary: applicants are the primary, and they are rendered
 * above this by PostedJobApplicants. What this step owns is the four levers —
 * Share, Boost, Edit, Cancel — least destructive first, Cancel last so the one
 * irreversible action is furthest from the thumb.
 *
 * The boost banner is a NOTICE (it states a fact and offers nothing), which is
 * why it is no longer a `mb-2` div hand-spaced above the row.
 */
export function OpenStep({ job, unfunded, onBoost, onEdit, onCancel }: PosterStepCtx) {
  const boostExp = job.boost_expires_at ? new Date(job.boost_expires_at) : null;
  const isBoosted = !!boostExp && boostExp > new Date();

  return (
    <JobStepCard
      side="poster"
      step="open"
      notice={
        isBoosted && boostExp ? (
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
        ) : null
      }
      actions={[
        <ShareJobButton
          key="share"
          job={{ id: job.id, title: job.title, budget: job.budget, category: job.category }}
          layout="stack"
          className={JOB_ACTION_CHIP_CLASS}
          style={jobActionChipStyle("share")}
        />,
        /* Boost sells REACH. An unfunded job has none — every browse surface
           filters on a funded payment_status — so charging to promote it would
           be selling nothing. Dropped entirely rather than disabled: a greyed
           chip invites a tap and an explanation, and UnfundedJobNotice already
           gives the poster the one action that helps. The shell counts the row,
           so it falls to 3 columns on its own. */
        unfunded ? null : (
          <JobActionChip
            key="boost"
            icon={Rocket}
            label={isBoosted ? "Boosted" : "Boost"}
            tone="boost"
            disabled={isBoosted}
            onClick={() => onBoost(job.id)}
          />
        ),
        <JobActionChip key="edit" icon={Pencil} label="Edit" ariaLabel="Edit job" tone="edit" onClick={() => onEdit(job)} />,
        <JobActionChip key="cancel" icon={XCircle} label="Cancel" ariaLabel="Cancel job" tone="danger" onClick={() => onCancel(job)} />,
      ]}
    />
  );
}
