import { JobStatusStrip } from "@/components/job-card/JobStatusStrip";
import { helperStatusLine, withDisputeSettling } from "@/components/job-card/jobStatusLine";
import type { AppliedApp, Job } from "../../../components/job-card/activityConstants";
import { CrewStatusStrip } from "./CrewMemberSection";

/**
 * WHAT THIS CARD IS WAITING ON — one sentence, at the collapsed Jobs card's
 * bottom edge (owner, 2026-09-19: "should show what we are waiting on...
 * remove the dots", and on the look: "similar to how dispute open displays").
 * Extracted from AppliedJobCard (component-size ratchet); the card mounts it
 * on `!isMinimalCard && !isExpanded`, exactly where the strip used to sit.
 *
 * THE SAME STRIP THE POSTER'S CARD WEARS, written from the HELPR's point of
 * view — one job, two readers, two sentences. "Approve & release pay" over
 * there is "With them for approval" here.
 *
 * IT ABSORBS THE COLLAPSED DISPUTE BADGE. That badge was the one thing a
 * collapsed disputed card said, and it survives verbatim as `tone: "alarm"` —
 * same words ("Dispute open" / "Admin reviewing" ... "Payment on hold"), same
 * sienna, same `data-dispute-open-badge` hook, so `helperDisputeCopy` still
 * pins that a Helpr scrolling My Jobs can see a 72-hour clock on their pay.
 * The PANEL stays behind the expand, which was already the ruling: controls
 * in, signal out.
 *
 * PURE RENDER — no query, no realtime channel, no tracker. It reads columns
 * the card already holds. That is also what the compact rail bought and this
 * keeps: the three expanded sections once mounted a full JobTracking on every
 * collapsed card, one subscription per row of the list. (A crew member's
 * strip reads their roster row through CrewMemberSection's query key, so it
 * costs no extra request either.)
 *
 * NOT ON A MINIMAL CARD. A not-selected or cancelled application already
 * leads its body with exactly this statement, in prose that says WHO cancelled
 * (`describeCancellation`) — which is more than a strip can carry. Two of them
 * would be the duplication this card keeps having removed. `deriveHelperWait`
 * still answers for those states (`not_selected` / `cancelled` / `job_gone`);
 * the card chooses not to draw a second copy.
 */
export function HelperCollapsedStrip({
  app,
  job,
  userId,
  isCrewLive,
  unsettledDisputeJobIds,
}: {
  app: AppliedApp;
  job: Job;
  userId: string;
  isCrewLive: boolean;
  unsettledDisputeJobIds: Parameters<typeof withDisputeSettling>[1];
}) {
  if (isCrewLive) {
    return <CrewStatusStrip app={app} job={job} userId={userId} unsettledDisputeJobIds={unsettledDisputeJobIds} />;
  }
  return <JobStatusStrip line={helperStatusLine(app.job ? { ...app, job: withDisputeSettling(app.job, unsettledDisputeJobIds) } : app)} />;
}
