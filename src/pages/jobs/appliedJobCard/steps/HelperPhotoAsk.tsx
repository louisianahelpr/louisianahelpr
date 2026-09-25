import { useQuery, useQueryClient } from "@tanstack/react-query";
import { PhotoProofCaptureChip } from "@/components/PhotoProof";
import { queryKeys } from "@/lib/queryKeys";
import { supabase } from "@/integrations/supabase/client";
import { unwrap } from "@/lib/supabaseResult";
import type { Job } from "../../../../components/job-card/activityConstants";

/**
 * ONE photo ask, belonging to the step the card is on — AS A CONTROL ON THE
 * CARD'S ACTION ROW.
 *
 * Owner, 2026-09-11: uploads "tie to tracker steps instead of sitting
 * always-on… one ask at a time, at the moment it makes sense". The group view
 * (PhotoProofGroup) stays the REVIEW surface — a completed job being looked
 * back on — and is never the ask on a live one.
 *
 * Owner again, 2026-09-19: "before and after buttons should also be on the
 * same lines as the other buttons." This used to render `PhotoProofStep` into
 * the card's `ask` slot: a titled panel with a hint line and a full-width "Add
 * Photo" button, stacked ABOVE the one action row VN-21 asked for. It is now a
 * single chip IN that row, the same object as Message and the primary beside
 * it (`PhotoProofCaptureChip`). The panel is gone rather than left behind with
 * its button removed — a heading and a hint with no control is not an ask.
 *
 * The one-line hint went with it, and that is the deliberate trade: the label
 * ("Before Photo" / "After Photo") plus the dialog's own "Before photos"
 * heading carry it, and the helper's blocked "Mark Job Complete" already
 * states the rule in full (`requiredProof().reason`) at the step where it
 * actually bites.
 *
 * The per-step order, and why:
 *
 *   on site  → Before, and only Before. There is no finished work to photograph.
 *   working  → After FIRST. The owner's state 4 screenshot showed "Add a before
 *              photo" sitting beside a payout request on a job that was already
 *              underway: the wrong step's ask, competing with the step's own.
 *              A still-missing Before is not dropped (the completion trigger
 *              `enforce_helper_completion_gates()` would refuse the job and the
 *              helper would have no way to satisfy it) — it simply falls to
 *              second, so it only ever appears once the After exists.
 *   dispute  → chronological, Before then After: this is evidence, not a step.
 *   revision → AFTER, ALWAYS. See below.
 *
 * Once a photo exists its ask is gone, so a satisfied job renders nothing here
 * and the row is one control shorter — with one deliberate exception, the
 * revision.
 *
 * ── THE REVISION, AND WHY IT BREAKS THE "ONCE A PHOTO EXISTS" RULE ────────
 * Owner, 2026-09-19, looking at a contested card: "here they have no way to
 * submit the photos after the dispute or revision."
 *
 * Half of that was already true — the helper's DISPUTED card has carried this
 * chip since item 10 this morning (DisputedSection). The other half was a real
 * hole: `RevisionStep` mounted no photo control at all, on the documented
 * grounds that "there is no photo ask in this state — one ask at a time, and
 * this is the one". That reasoning was about the `ask` SLOT, which the
 * revision panel rightly owns; it stopped being a reason for anything the
 * moment the capture control became a chip in the row (owner, same day).
 *
 * A revision is a SECOND ROUND OF WORK on the same job, and the after photo is
 * what the poster will judge the fix by — so the ask here is the After, and it
 * does NOT disappear once an after photo exists. That is the whole point: the
 * helper already uploaded one for the first submission, and gating on
 * emptiness would mean the state that most needs a new photo is the one state
 * that cannot take one. `PhotoProof` APPENDS to the array, so a second after
 * photo joins the first rather than replacing it, and both are evidence.
 *
 * The Before still falls through when it is genuinely missing —
 * `enforce_helper_completion_gates()` will refuse the job for it, so leaving it
 * unreachable would be the same dead end in another place.
 */
export function HelperPhotoAsk({
  jobId,
  job,
  step,
}: {
  jobId: string;
  job: Job;
  step: "on_site" | "working" | "dispute" | "revision";
}) {
  // The poster's per-job answer (`jobs.require_photo_proof`). `?? true` because
  // a client running against a database that predates the column must keep
  // today's behaviour — and the migration that adds the column patches the
  // completion trigger in the same file, so the ask can never be hidden on a
  // database whose gate would still refuse the completion.
  const proofRequired = ((job as { require_photo_proof?: boolean | null }).require_photo_proof ?? true) !== false;

  // READ THE JOB BACK AFTER AN UPLOAD — do not wait for realtime to do it.
  //
  // This ask advances on data: once the After photo exists, the Before ask is
  // the one that renders. `PhotoProofStep` defaults its `onUploaded` to a
  // no-op, so the only thing that moved the card forward was the realtime
  // `jobs` subscription in useActivityData invalidating `["activity"]`. That
  // channel is best-effort by this codebase's own account — it drops on a cold
  // native socket, which is why AutoTip reads back explicitly for the same
  // reason. With it down, a helper uploads the After photo, the dialog closes,
  // and the card still says "Add an after photo". They re-upload, or they
  // believe they are done while `enforce_helper_completion_gates` refuses the
  // job for the missing Before — on the step that releases their payout.
  //
  // Invalidating the same key the realtime handler does makes the card's next
  // state certain rather than hopeful; a live channel simply makes it redundant.
  const queryClient = useQueryClient();
  const readBack = () => {
    void queryClient.invalidateQueries({ queryKey: queryKeys.activity.all });
  };

  // A CREW HAS NO LEAD (Q407). On a group job each member's proof is their OWN
  // roster row (group_job_helpers), which is what their Working step and
  // completion gate read; the job's columns belong to nobody on a crew. Keyed
  // under ["activity"] so readBack() above refreshes it too.
  const crew = job.is_group_job === true;
  const slotProof = useQuery({
    queryKey: [...queryKeys.activity.all, "crewSlotProof", jobId] as const,
    enabled: crew,
    queryFn: async () => {
      const { data: auth } = await supabase.auth.getSession();
      const me = auth.session?.user?.id;
      if (!me) return null;
      const rows = unwrap(
        await supabase
          .from("group_job_helpers")
          .select("proof_before_urls, proof_after_urls")
          .eq("job_id", jobId)
          .eq("helper_id", me)
          .limit(1),
      );
      return rows[0] ?? null;
    },
  });

  if (!proofRequired) return null;
  // No ask until the member's own photos are known: offering Before on a stale
  // empty array would append to nothing and drop the photos already filed.
  if (crew && !slotProof.isSuccess) return null;

  const beforeUrls = (crew ? slotProof.data?.proof_before_urls : job.proof_before_urls) || [];
  const afterUrls = (crew ? slotProof.data?.proof_after_urls : job.proof_after_urls) || [];

  const beforeAsk = (
    <PhotoProofCaptureChip
      jobId={jobId}
      type="before"
      existingUrls={beforeUrls}
      onUploaded={readBack}
      label="Before Photo"
      crew={crew}
    />
  );
  const afterAsk = (
    <PhotoProofCaptureChip
      jobId={jobId}
      type="after"
      existingUrls={afterUrls}
      onUploaded={readBack}
      label="After Photo"
      crew={crew}
    />
  );

  if (step === "revision") {
    // ALWAYS offered. A revision is a second round of work and the new after
    // photo is the evidence it happened; see the note above. The Before is
    // still reachable when it is missing, because the completion trigger will
    // refuse the job for it either way.
    if (beforeUrls.length === 0) return beforeAsk;
    return afterAsk;
  }
  if (step === "working") {
    if (afterUrls.length === 0) return afterAsk;
    if (beforeUrls.length === 0) return beforeAsk;
    return null;
  }
  // on_site and dispute both start from the Before.
  if (beforeUrls.length === 0) return beforeAsk;
  if (step === "dispute" && afterUrls.length === 0) return afterAsk;
  return null;
}
