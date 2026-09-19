import { CheckCircle2 } from "lucide-react";
import { posterConfirmationRung, derivePosterStep } from "./steps/posterStepContract";
import type { Job } from "../activityConstants";

/**
 * "YOU OWE A CONFIRMATION" — on the COLLAPSED posted-job card.
 *
 * Owner decision, 2026-09-19: the confirmation controls themselves stay inside
 * the EXPANDED card, but a collapsed card has to say one is waiting. This is
 * the likeliest reason the owner saw "no button to confirm they arrived" at
 * all: every action block on PostedJobCard is behind the expand, so a poster
 * scrolling their list has no way to learn a decision is theirs to take.
 *
 * Same shape, same place and same treatment as the collapsed DISPUTE badge
 * directly above it in PostedJobCard — a one-line strip under the title bar —
 * so the card has one way of announcing "there is something for you in here"
 * rather than two. The tone is bark (the app's own "your move" green), not the
 * dispute's sienna: nothing is wrong, something is waiting.
 *
 * It is NOT a control. Tapping the strip does nothing of its own; the card's
 * own expand gesture is underneath it, which is exactly the behaviour wanted —
 * the badge says "open me", the card opens.
 *
 * SELF-GATING, so the wiring in PostedJobCard is one line and the rule lives
 * in one place: it renders only when `posterConfirmationRung` says the poster
 * has a confirmation they could take right now (never for a box that is merely
 * disabled or already done — those are not owed, they are just visible).
 */
export function PosterConfirmationBadge({ job }: { job: Job }) {
  const step = derivePosterStep(job.status);
  const rung = step ? posterConfirmationRung(job, step) : null;
  if (!rung?.enabled) return null;

  return (
    <div
      className="px-4 py-2 flex items-center gap-1.5"
      data-poster-owes-confirmation=""
      style={{
        borderTop: "0.5px solid hsl(var(--bark) / 0.22)",
        background: "hsl(var(--bark) / 0.08)",
      }}
    >
      <CheckCircle2 className="w-3 h-3 shrink-0" style={{ color: "hsl(var(--bark))" }} />
      <span
        className="font-sans uppercase text-ds-10"
        style={{ color: "hsl(var(--bark))", letterSpacing: "0.18em" }}
      >
        Needs your OK
      </span>
      {/* The words of the box waiting inside, so the collapsed card and the
          expanded one name the same action rather than describing it twice. */}
      <span className="font-sans text-ds-11 ml-auto" style={{ color: "hsl(var(--olivewood) / 0.85)" }}>
        {rung.label}
      </span>
    </div>
  );
}
