/**
 * Helpr Guarantee on the job page (owner 2026-10-27, "Redo first, then refund"; migration 20261027200455).
 *
 * The poster sees a short explainer, and for 48 hours after the job is done, "Not done right" (a note and up to 6
 * photos). The hired Helpr then sees the note and photos and answers: Accept fix with a day (today to 3 days out)
 * or Can't fix; after the fix, Mark fixed. The poster says It's fixed or Still not right. Each side sees where it
 * stands. While it is open the Helpr's pay waits; an admin decides anything not fixed, and a refund is of the job
 * price. No fee numbers anywhere (owner rule).
 */
import { endSentence } from "@/lib/endSentence";
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ImagePlus, ShieldCheck } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { useProofPhotoUrls } from "@/hooks/useProofPhotoUrls";
import { queryKeys } from "@/lib/queryKeys";
import {
  GUARANTEE_RULES,
  canAskForFix,
  fetchGuaranteeClaim,
  fixDateChoices,
  fixDateLabel,
  guaranteeErrorText,
  helprAnswerGuarantee,
  markGuaranteeFixed,
  openGuaranteeClaim,
  posterAnswerGuarantee,
  uploadGuaranteePhotos,
  type GuaranteeClaim,
  type GuaranteeJob,
  guaranteeExplainerApplies,
} from "@/lib/guarantee";

// The summary panel's own card style (JobPageParts CARD): a card on a phone, a ruled section inside the panel from lg.
const CARD = "space-y-3 rounded-2xl border border-border bg-card p-4 lg:rounded-none lg:border-0 lg:border-t lg:!border-border lg:bg-transparent lg:p-0 lg:pt-4 lg:!shadow-none";

const when = (iso: string | null) =>
  iso ? new Intl.DateTimeFormat("en-US", { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }).format(new Date(iso)) : "";

/** The poster's one-paragraph explainer (also in the Terms). */
function GuaranteeExplainer() {
  return (
    <p data-guarantee-explainer="" className="text-ds-13 text-muted-foreground">
      Not done right? Tell us within 48 hours of
      the job being done. Your Helpr comes back to fix it, and their pay waits until it's settled. If it can't be fixed,
      we decide whether you get a refund of the job price.
    </p>
  );
}

function ClaimPhotos({ paths }: { paths: string[] }) {
  const urls = useProofPhotoUrls(paths);
  if (paths.length === 0) return null;
  return (
    <div role="group" className="flex flex-wrap gap-2" aria-label="Photos">
      {urls.map((u, i) =>
        u ? <img key={paths[i]} src={u} alt={`Photo ${i + 1}`} className="h-20 w-20 rounded-xl object-cover" /> : null,
      )}
    </div>
  );
}

function useGuaranteeAction(jobId: string) {
  const qc = useQueryClient();
  return (fn: () => Promise<unknown>, done: string) =>
    ({
      mutationFn: fn,
      onSuccess: () => {
        toast(done);
        void qc.invalidateQueries({ queryKey: ["guarantee", jobId] });
        void qc.invalidateQueries({ queryKey: queryKeys.jobs.all });
      },
      onError: (e: unknown) => toast.error(guaranteeErrorText(e)),
    }) as const;
}

function AskForFix({ job, userId }: { job: GuaranteeJob; userId: string }) {
  const [open, setOpen] = useState(false);
  const [note, setNote] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const action = useGuaranteeAction(job.id);
  const send = useMutation(
    action(async () => {
      const paths = await uploadGuaranteePhotos(userId, job.id, files);
      return openGuaranteeClaim(job.id, note.trim(), paths);
    }, "Sent. Your Helpr will answer within 48 hours."),
  );
  const short = note.trim().length < GUARANTEE_RULES.noteMin;
  if (!open) {
    return (
      <Button type="button" variant="outline" className="w-full rounded-full" onClick={() => setOpen(true)}>
        Not done right
      </Button>
    );
  }
  return (
    <div className="space-y-3" data-guarantee-form="">
      <div className="space-y-1.5">
        <Label htmlFor="guarantee-note">What wasn't done right?</Label>
        <Textarea
          id="guarantee-note"
          value={note}
          maxLength={GUARANTEE_RULES.noteMax}
          onChange={(e) => setNote(e.target.value)}
          placeholder="For example: two of the shelves are crooked and one bracket is loose."
        />
      </div>
      <div className="space-y-1.5">
        <p className="text-ds-14 font-medium">Photos (up to {GUARANTEE_RULES.maxPhotos})</p>
        <div className="flex flex-wrap items-center gap-3">
          <label
            htmlFor="guarantee-photos"
            className="inline-flex min-h-[44px] cursor-pointer items-center gap-2 rounded-full border border-border bg-card px-4 text-ds-14 font-semibold focus-within:ring-2 focus-within:ring-ring"
          >
            <ImagePlus className="h-4 w-4" aria-hidden />
            Add photos
            <input
              id="guarantee-photos"
              type="file"
              accept="image/*"
              multiple
              className="sr-only"
              onChange={(e) => setFiles(Array.from(e.target.files ?? []).slice(0, GUARANTEE_RULES.maxPhotos))}
            />
          </label>
          <span className="text-ds-13 text-muted-foreground" aria-live="polite">
            {files.length === 0 ? "None yet" : `${files.length} photo${files.length === 1 ? "" : "s"} added`}
          </span>
        </div>
      </div>
      <div className="flex flex-wrap gap-2">
        <Button type="button" variant="ghost" className="rounded-full" disabled={send.isPending} onClick={() => setOpen(false)}>
          Cancel
        </Button>
        <Button type="button" variant="primary" className="rounded-full" disabled={short || send.isPending} onClick={() => send.mutate()}>
          {send.isPending ? "Sending…" : "Ask for a fix"}
        </Button>
      </div>
    </div>
  );
}

function PosterView({ claim, jobId }: { claim: GuaranteeClaim; jobId: string }) {
  const [rejecting, setRejecting] = useState(false);
  const [note, setNote] = useState("");
  const action = useGuaranteeAction(jobId);
  const fixed = useMutation(action(() => posterAnswerGuarantee(claim.id, true, null), "Thanks. It's all settled."));
  const reject = useMutation(action(() => posterAnswerGuarantee(claim.id, false, note.trim()), "Sent. An admin will decide."));
  switch (claim.status) {
    case "awaiting_helpr":
      return <p className="text-ds-14">You asked for a fix. Your Helpr answers by {endSentence(when(claim.helpr_answer_by))}</p>;
    case "fix_scheduled":
      return <p className="text-ds-14">Your Helpr will fix it on {claim.fix_date ? fixDateLabel(claim.fix_date) : "the day they picked"}. Message them in the job to set a time.</p>;
    case "fixed":
      return (
        <div className="space-y-3">
          <p className="text-ds-14">Your Helpr says it's fixed. Take a look and tell us by {endSentence(when(claim.poster_answer_by))} If we don't hear from you, it counts as fixed.</p>
          {rejecting ? (
            <div className="space-y-2">
              <Label htmlFor="guarantee-reject">What's still not right?</Label>
              <Textarea id="guarantee-reject" value={note} maxLength={GUARANTEE_RULES.noteMax} onChange={(e) => setNote(e.target.value)} />
              <Button type="button" variant="primary" className="rounded-full" disabled={note.trim().length < GUARANTEE_RULES.noteMin || reject.isPending} onClick={() => reject.mutate()}>
                {reject.isPending ? "Sending…" : "Send to an admin"}
              </Button>
            </div>
          ) : (
            <div className="flex flex-wrap gap-2">
              <Button type="button" variant="outline" className="rounded-full" onClick={() => setRejecting(true)}>
                Still not right
              </Button>
              <Button type="button" variant="primary" className="rounded-full" disabled={fixed.isPending} onClick={() => fixed.mutate()}>
                It's fixed
              </Button>
            </div>
          )}
        </div>
      );
    case "escalating":
    case "disputed":
      return <p className="text-ds-14">An admin is deciding this, including whether you get a refund of the job price.</p>;
    default:
      return claim.close_reason === "job_moved_on" ? null : <p className="text-ds-14">Settled: fixed.</p>;
  }
}

function HelprView({ claim, jobId }: { claim: GuaranteeClaim; jobId: string }) {
  const days = fixDateChoices();
  const [day, setDay] = useState<string>(days[1] ?? days[0]);
  const [cantFix, setCantFix] = useState(false);
  const action = useGuaranteeAction(jobId);
  const accept = useMutation(action(() => helprAnswerGuarantee(claim.id, true, day), "Thanks. They know when you're coming."));
  const decline = useMutation(action(() => helprAnswerGuarantee(claim.id, false, null), "Sent. An admin will decide."));
  const fixed = useMutation(action(() => markGuaranteeFixed(claim.id), "Thanks. They'll take a look."));
  switch (claim.status) {
    case "awaiting_helpr":
      return (
        <div className="space-y-3">
          <p className="text-ds-14 font-semibold">The person who posted this job says it wasn't done right.</p>
          <p className="whitespace-pre-line text-ds-14 [overflow-wrap:anywhere]">{claim.note}</p>
          <ClaimPhotos paths={claim.photo_paths} />
          {/* F31: helpr_answer_by is when the ANSWER is due (the Terms: "48 hours to pick a day to fix it (within 3
              days)"); it read "fix it by <that time>" over chips running past it. */}
          <p className="text-ds-13 text-muted-foreground">Answer by {endSentence(when(claim.helpr_answer_by))} Pick the day you'll come back to fix it. Your pay for this job waits until it's settled.</p>
          <div role="radiogroup" aria-label="Day to fix it" className="flex flex-wrap gap-2">
            {days.map((d) => (
              <Button key={d} type="button" size="sm" role="radio" aria-checked={day === d} variant={day === d ? "primary" : "outline"} className="rounded-full" onClick={() => setDay(d)}>
                {fixDateLabel(d)}
              </Button>
            ))}
          </div>
          {cantFix ? (
            <div className="space-y-2">
              <p className="text-ds-13">An admin will decide, and may refund the job price.</p>
              <div className="flex flex-wrap gap-2">
                <Button type="button" variant="outline" className="rounded-full" disabled={decline.isPending} onClick={() => decline.mutate()}>
                  Yes, I can't fix it
                </Button>
                <Button type="button" variant="ghost" className="rounded-full" onClick={() => setCantFix(false)}>
                  Back
                </Button>
              </div>
            </div>
          ) : (
            <div className="flex flex-wrap gap-2">
              <Button type="button" variant="outline" className="rounded-full" onClick={() => setCantFix(true)}>
                Can't fix
              </Button>
              <Button type="button" variant="primary" className="rounded-full" disabled={accept.isPending} onClick={() => accept.mutate()}>
                Accept fix
              </Button>
            </div>
          )}
        </div>
      );
    case "fix_scheduled":
      return (
        <div className="space-y-3">
          <p className="text-ds-14">You're fixing it on {claim.fix_date ? fixDateLabel(claim.fix_date) : "the day you picked"}. When it's done, tap Mark fixed.</p>
          <Button type="button" variant="primary" className="rounded-full" disabled={fixed.isPending} onClick={() => fixed.mutate()}>
            Mark fixed
          </Button>
        </div>
      );
    case "fixed":
      return <p className="text-ds-14">The person who posted this job takes a look by {endSentence(when(claim.poster_answer_by))} If they don't answer, it counts as fixed.</p>;
    case "escalating":
    case "disputed":
      return <p className="text-ds-14">An admin is deciding this. Your pay for this job waits until then.</p>;
    default:
      return claim.close_reason === "job_moved_on" ? null : <p className="text-ds-14">Settled. Your pay goes out on the usual schedule.</p>;
  }
}

export function HelprGuaranteePanel({ job, userId, side }: { job: GuaranteeJob; userId: string; side: "poster" | "helpr" | null }) {
  // A claim exists only on a finished one-Helpr job: nothing to read before that (the poster still sees the explainer).
  const enabled = !!side && job.status !== "open" && !job.is_group_job;
  const claim = useQuery({ queryKey: ["guarantee", job.id], queryFn: () => fetchGuaranteeClaim(job.id), enabled });
  if (side === "poster" && !job.is_group_job && !enabled) {
    // JA-28: an open job (posted, not yet worked) cannot use the guarantee: no explainer yet.
    if (!guaranteeExplainerApplies(job)) return null;
    return (
      <section aria-label="Helpr Guarantee" data-guarantee-panel="poster" className={CARD}>
        <p className="flex items-center gap-2 text-ds-15 font-semibold"><ShieldCheck className="h-4 w-4 text-primary" aria-hidden />Helpr Guarantee</p>
        <GuaranteeExplainer />
      </section>
    );
  }
  if (!enabled || claim.isLoading) return null;
  const c = claim.data ?? null;
  if (side === "helpr") {
    if (!c) return null;
    return (
      <section aria-label="Helpr Guarantee" data-guarantee-panel="helpr" className={CARD}>
        <p className="flex items-center gap-2 text-ds-15 font-semibold"><ShieldCheck className="h-4 w-4 text-primary" aria-hidden />Helpr Guarantee</p>
        <HelprView claim={c} jobId={job.id} />
      </section>
    );
  }
  const ask = !claim.isError && canAskForFix(job, userId, c);
  // JA-28: with no claim, the explainer only where the guarantee applies (Working to 48 h after Done, no open dispute).
  if (!c && !ask && !guaranteeExplainerApplies(job)) return null;
  return (
    <section aria-label="Helpr Guarantee" data-guarantee-panel="poster" className={CARD}>
      <p className="flex items-center gap-2 text-ds-15 font-semibold"><ShieldCheck className="h-4 w-4 text-primary" aria-hidden />Helpr Guarantee</p>
      {c ? <PosterView claim={c} jobId={job.id} /> : <GuaranteeExplainer />}
      {ask && <AskForFix job={job} userId={userId} />}
    </section>
  );
}
