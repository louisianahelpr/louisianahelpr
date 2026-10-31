import { useState } from "react";
import { DollarSign, CheckCircle2, Star, RotateCcw, Image, CalendarPlus, Tag } from "lucide-react";
import { JobStepCard } from "@/components/job-card/JobStepCard";
import { JobActionChip, JobStepPrimaryButton } from "../../../../components/job-card/JobActionRow";
import { PhotoProofDialog } from "@/components/PhotoProof";
import type { PosterStepCtx } from "./posterStepContract";
import { reviewWindowOpen } from "@/lib/reviewWindow";
import { FORMER_MEMBER_LABEL } from "@/lib/deletedPerson";
import { useAgeGate } from "@/hooks/useAgeGate";
import { bookAgainLabel, bookAgainLink } from "@/lib/bookAgain";
import { isSellForMeJob, SELL_FOR_ME_LISTINGS_PATH } from "@/lib/declutter/sellForMe";
import { tipsNotReadyLine, useHelprTakesTips } from "@/hooks/useHelprTakesTips";

/**
 * POSTER STEP 4 — done.
 *
 * Nothing is being asked and nothing is primary: the job is over and every
 * remaining control is optional. So this state is a review surface plus one
 * row — Tip · Review · Hire again.
 *
 * No Dispute and no Report Job here (owner rule, 2026-09-14, VN-28: "they
 * can't report a job once it's done"). This reverses the earlier 7-day
 * post-completion dispute window and the Done-tab Report Job chip.
 *
 * The proof is a BUTTON on that row now, not a panel above it (owner item 10,
 * 2026-09-19: "before & after pictures" goes on the same row as the other
 * action buttons). It still renders only when there ARE photos (owner: "move
 * to the collapsed part") — an empty group printed two rows of chrome to
 * report an absence, and an empty gallery behind a chip would be a dead tap.
 */
/**
 * One crew member's tip row (Q709(c)). F29 per member: a member whose payout
 * setup is not finished cannot receive a tip (create-payment refuses it), so
 * their row offers none and says why in the same line the single-Helpr card
 * uses (useHelprTakesTips; unknown keeps the Tip offered).
 */
function CrewTipRow({ member: m, onTip }: { member: { id: string; name: string; tipped: boolean }; onTip: () => void }) {
  const takesTips = useHelprTakesTips(m.id, !m.tipped);
  if (!m.tipped && takesTips === false) {
    return (
      <li className="space-y-0.5">
        <span className="block text-ds-13 text-foreground truncate">{m.name}</span>
        <p className="text-ds-12 text-muted-foreground" data-testid="tips-not-ready">{tipsNotReadyLine(m.name)}</p>
      </li>
    );
  }
  return (
    <li className="flex items-center justify-between gap-2">
      <span className="text-ds-13 text-foreground truncate min-w-0 flex-1">{m.name}</span>
      {/* The row chip is w-full by design (it shares a row); here it
          sits beside a name, so it gets the width of one row slot. */}
      <div className="w-[5.5rem] shrink-0">
        {m.tipped ? (
          <JobActionChip
            icon={CheckCircle2}
            label="Tipped"
            ariaLabel={`Tipped — you already tipped ${m.name}`}
            tone="done"
            disabled
            onClick={() => {}}
          />
        ) : (
          <JobActionChip
            icon={DollarSign}
            label="Tip"
            ariaLabel={`Tip ${m.name}`}
            tone="boost"
            onClick={onTip}
          />
        )}
      </div>
    </li>
  );
}

export function CompletedStep({
  job,
  helperNames,
  completedJobMeta,
  navigate,
  onTip,
  onReview,
}: PosterStepCtx) {
  const [photosOpen, setPhotosOpen] = useState(false);
  // Q1586(c): Hire again / Re-Post start a post; greyed out under 18, a tap says why.
  const { gate: ageGate, gatedProps: ageGatedProps } = useAgeGate();
  const meta = completedJobMeta[job.id];
  const hasTipped = meta?.tipped;
  const hasReviewed = meta?.reviewed;
  // Q369: a completed job always had a Helpr; a NULL helper_id is one who
  // deleted their account (jobs_helper_id_fkey ON DELETE SET NULL).
  const helperName = job.helper_id ? helperNames[job.helper_id] || "Helpr" : FORMER_MEMBER_LABEL;
  // A crew has no lead (Q407): the poster reviews each member, one at a time,
  // and the chip names the next one. `reviewed` means every member is done.
  const crew = job.is_group_job === true;
  const nextCrewMember = crew ? meta?.crewToReview?.[0] : undefined;
  const reviewName = crew ? nextCrewMember?.name ?? "your crew" : helperName;
  // The Review button on a crew names the crew it belongs to, not only the next member (audit 2026-10-28 A2-C35:
  // its name read "leave a review for Eli" on a three-person crew). Guard: src/test/crewCopyNamesTheCrew.test.tsx.
  const crewLeft = meta?.crewToReview?.length ?? 0;
  const reviewAria = crew && nextCrewMember
    ? `Review — review your crew, one at a time: ${nextCrewMember.name} next${crewLeft > 1 ? `, ${crewLeft} left` : ""}`
    : `Review — leave a review for ${reviewName}`;
  const hasProof = (job.proof_before_urls?.length ?? 0) > 0 || (job.proof_after_urls?.length ?? 0) > 0;
  // Q709(c), owner 2026-10-05: a crew is tipped member by member, ONE Tip per
  // member row, each showing "Tipped" once that member has been tipped (like
  // the Review button's per-member state). The server takes the member's id
  // (create-payment refuses a crew tip without one).
  const crewTips = crew ? meta?.crewTips ?? [] : [];
  // F29 (audit 2026-10-28): a Helpr whose payout setup is not finished cannot
  // receive a tip (create-payment refuses it). Decided here, from the same
  // fact the hire row's Select reads, so the Tip is never offered and refused.
  const tipOpen = !crew && !hasTipped;
  const takesTips = useHelprTakesTips(job.helper_id, tipOpen);
  const offerTip = tipOpen && takesTips !== false;

  // Approving completion leaves the job at 'payout_pending' until the transfer
  // settles, so gating Review on 'released' hid it during exactly the window
  // when the app auto-opens the rating sheet. Matches the reviews INSERT policy.
  // DH-003: once the review window has closed, "Reviewed" still shows but an
  // unreviewed job no longer offers a Review the server would refuse.
  // AL-009: a helper who deleted their account leaves helper_id NULL, and
  // openReviewForPosted returns silently on a NULL helper, so the chip would
  // be a dead control. The helper side gates on posterId the same way.
  const canReview =
    (crew ? !!hasReviewed || !!nextCrewMember : !!job.helper_id) &&
    (job.payment_status === "released" || job.payment_status === "payout_pending") &&
    (!!hasReviewed || reviewWindowOpen(job));

  return (
    <JobStepCard
      side="poster"
      step="completed"
      /* REVIEW AND TIP ARE THE ROW'S PRIMARIES, right of More (owner,
         2026-10-08: "tip and review is also a primary button ... all primary
         buttons should be to the right of more"). Once done they are the
         quiet "Reviewed" / "Tipped" chips inside More. */
      primary={
        (canReview && !hasReviewed) || offerTip ? (
          <>
            {canReview && !hasReviewed ? (
              <JobStepPrimaryButton icon={Star} label="Review" ariaLabel={reviewAria} onClick={() => onReview(job)} />
            ) : null}
            {offerTip ? (
              <JobStepPrimaryButton icon={DollarSign} label="Tip" ariaLabel={`Tip ${helperName}`} onClick={() => onTip(job.id, helperName)} />
            ) : null}
          </>
        ) : undefined
      }
      ask={tipOpen && takesTips === false ? (
        <p className="text-ds-13 text-muted-foreground" data-testid="tips-not-ready">{tipsNotReadyLine(helperName)}</p>
      ) : crewTips.length > 0 ? (
        <ul className="space-y-1.5" aria-label="Tip your crew" data-crew-tips>
          {crewTips.map((m) => (
            <CrewTipRow key={m.id} member={m} onTip={() => onTip(job.id, m.name, m.id)} />
          ))}
        </ul>
      ) : undefined}
      actions={[
        /* The before & after pictures, first in the row: the quietest control
           here and the only one that isn't a fresh decision — Tip, Review and
           Hire again all are, and the owner's primary-right rule (V2/V3) keeps
           the loudest of them on the right. */
        hasProof ? (
          <JobActionChip
            key="photos"
            icon={Image}
            label="Photos"
            ariaLabel="Photos — the before and after proof photos from this job"
            tone="neutral"
            onClick={() => setPhotosOpen(true)}
          />
        ) : null,
        /* A crew (Q407) is tipped member by member: one Tip per member row in
           the `ask` slot above (Q709(c)), so this job-level chip, which has no
           member to name, is not drawn on a crew. */
        crew || !hasTipped ? null : (
          <JobActionChip
            key="tip"
            icon={CheckCircle2}
            label="Tipped"
            ariaLabel={`Tipped — you already tipped ${helperName}`}
            tone="done"
            disabled
            onClick={() => {}}
          />
        ),
        canReview
          ? !hasReviewed
            ? null
            : (
              <JobActionChip
                key="review"
                icon={CheckCircle2}
                label="Reviewed"
                ariaLabel={`Reviewed — you already reviewed ${reviewName}`}
                tone="done"
                disabled
                onClick={() => {}}
              />
            )
          : null,
        /* POST-H3: a Helpr who helped list the poster's things: the job leads to those listings (what sold;
           Lower price, Give it away free and haul-away for what didn't). Quiet: not a fresh decision. */
        isSellForMeJob(job.category) ? (
          <JobActionChip
            key="listings"
            icon={Tag}
            label="Your listings"
            ariaLabel="Your listings — see what sold, and lower, give away or haul away the rest"
            tone="neutral"
            onClick={() => navigate(SELL_FOR_ME_LISTINGS_PATH)}
          />
        ) : null,
        /* Book <Helpr> again (Q2471 #3, owner 2026-10-29): the SAME job copied
           (never its date) as a direct offer to this Helpr, opening at When
           and where so only the date is left. One Helpr only: a crew job has
           no one Helpr to offer it to. */
        job.helper_id && !crew ? (
          <JobActionChip
            key="book-again"
            icon={CalendarPlus}
            label={bookAgainLabel(helperName)}
            ariaLabel={`${bookAgainLabel(helperName)} — the same job for ${helperName}, you pick the date`}
            tone="primary"
            onClick={ageGate("post", () => navigate(bookAgainLink(job.id, job.helper_id as string)))}
            ageGated={ageGatedProps("post")}
          />
        ) : null,
        /* Hire again — direct offer to the same helper for ANY job: a blank
           PostJob with offerTo only (owner 2026-10-25: not prefilled from this
           job). Post again below is the prefilled copy. */
        job.helper_id ? (
          <JobActionChip
            key="again"
            icon={RotateCcw}
            label="Hire again"
            ariaLabel={`Hire again — hire ${helperName} for a new job`}
            tone="primary"
            onClick={ageGate("post", () => navigate(`/post-job?offerTo=${job.helper_id}`))}
            ageGated={ageGatedProps("post")}
          />
        ) : (
          <JobActionChip
            key="again"
            icon={RotateCcw}
            label="Re-Post"
            ariaLabel="Re-Post — post this job again"
            tone="primary"
            onClick={ageGate("post", () => navigate(`/post-job?rebook=${job.id}`))}
            ageGated={ageGatedProps("post")}
          />
        ),
      ]}
      dialogs={
        <PhotoProofDialog
          open={photosOpen}
          onOpenChange={setPhotosOpen}
          beforeUrls={job.proof_before_urls || []}
          afterUrls={job.proof_after_urls || []}
        />
      }
    />
  );
}
