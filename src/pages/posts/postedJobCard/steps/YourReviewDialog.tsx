import { useQuery } from "@tanstack/react-query";
import { Star } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHero,
  DialogBody,
  DialogFooter,
  DialogAcknowledgeAction,
} from "@/components/ui/dialog";
import { supabase } from "@/integrations/supabase/client";
import { queryKeys } from "@/lib/queryKeys";
import { unwrap } from "@/lib/supabaseResult";
import { reviewText, withReviewTags } from "@/lib/reviewTags";
import { STAR_ON_CLS } from "@/lib/starColor";
import { FORMER_MEMBER_LABEL } from "@/lib/deletedPerson";
import { ReportErrorScreen } from "@/components/ui/ReportErrorScreen";
import { InlineTextButton } from "@/components/ui/InlineTextButton";

/**
 * F278 (audit 11-10): the poster's done job used to show a disabled "Reviewed"
 * chip, a status with nothing behind it; the poster could not see the review
 * they left. "See your review" opens this: the review(s) the signed-in member
 * wrote on this job, read-only. The reviews SELECT policy lets a reviewer read
 * their own rows before the double-blind reveal, so the "not shown yet" line
 * is read from feedback_visible_at, never guessed.
 * Guard: src/pages/posts/postedJobCard/steps/YourReviewDialog.test.tsx.
 */
type YourReview = {
  id: string;
  rating: number;
  feedback: string | null;
  tags?: string[] | null;
  reviewee_id: string;
  feedback_visible_at: string | null;
};

export function YourReviewDialog({
  open,
  onOpenChange,
  jobId,
  userId,
  names,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  jobId: string;
  userId: string;
  /** Reviewee names by user id (helperNames); a missing name reads "your Helpr". */
  names: Record<string, string>;
}) {
  const { data, isLoading, isError, refetch } = useQuery<YourReview[]>({
    queryKey: queryKeys.yourReviews.forJob(userId, jobId),
    enabled: open && !!userId && !!jobId,
    queryFn: async () => {
      const rows = unwrap(await withReviewTags(
        () =>
          supabase
            .from("reviews")
            .select("id, rating, feedback, tags, reviewee_id, feedback_visible_at")
            .eq("job_id", jobId)
            .eq("reviewer_id", userId)
            .order("created_at", { ascending: true }),
        () =>
          supabase
            .from("reviews")
            .select("id, rating, feedback, reviewee_id, feedback_visible_at")
            .eq("job_id", jobId)
            .eq("reviewer_id", userId)
            .order("created_at", { ascending: true }),
      ));
      return (rows ?? []) as YourReview[];
    },
  });
  const now = Date.now();
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHero title="Your review" />
        <DialogBody>
          {isLoading ? (
            <p className="text-ds-14 text-muted-foreground">Loading your review…</p>
          ) : isError ? (
            // Inside a job card, so no ErrorState card (noNestedTrackerCard); the hand-drawn line still reports (errorSurfacesReport).
            <div role="alert" className="space-y-1">
              <ReportErrorScreen source="YourReviewDialog" title="Your review couldn't load." />
              <p className="text-ds-14 text-foreground">Your review couldn't load.</p>
              <InlineTextButton onClick={() => void refetch()}>Try again</InlineTextButton>
            </div>
          ) : !data || data.length === 0 ? (
            <p className="text-ds-14 text-muted-foreground">We couldn't find your review for this job.</p>
          ) : (
            <ul className="space-y-4">
              {data.map((r) => {
                const name = names[r.reviewee_id] || (r.reviewee_id ? "your Helpr" : FORMER_MEMBER_LABEL);
                const text = reviewText(r.feedback, r.tags);
                const shown = r.feedback_visible_at !== null && Date.parse(r.feedback_visible_at) <= now;
                return (
                  <li key={r.id} className="space-y-1" data-your-review={r.id}>
                    <p className="text-ds-14 font-semibold text-foreground">For {name}</p>
                    <p className="flex items-center gap-0.5" role="img" aria-label={`${r.rating} out of 5 stars`}>
                      {[1, 2, 3, 4, 5].map((n) => (
                        <Star key={n} aria-hidden className={`h-4 w-4 ${n <= r.rating ? STAR_ON_CLS : "text-muted-foreground"}`} />
                      ))}
                    </p>
                    <p className="text-ds-14 text-foreground [overflow-wrap:anywhere]">{text ?? "You left stars only, no words."}</p>
                    {shown ? null : (
                      <p className="text-ds-13 text-muted-foreground">Not shown to {name} yet.</p>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </DialogBody>
        <DialogFooter>
          <DialogAcknowledgeAction>Close</DialogAcknowledgeAction>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
