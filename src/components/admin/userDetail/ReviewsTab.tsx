import { Star } from "lucide-react";
import { TabsContent } from "@/components/ui/tabs";
import { formatShortDate } from "@/lib/format";

type ReviewReceived = {
  rating: number;
  feedback: string | null;
  reviewer_name: string;
  created_at?: string;
  job_title?: string;
};

type ReviewLeft = {
  rating: number;
  feedback: string | null;
  reviewee_name: string;
  created_at?: string;
  job_title?: string;
};

interface ReviewsTabProps {
  profileReviews: ReviewReceived[];
  profileReviewsLeft: ReviewLeft[];
}

export function ReviewsTab({ profileReviews, profileReviewsLeft }: ReviewsTabProps) {
  return (
    <TabsContent value="reviews" className="space-y-6 mt-4 flex-1 min-h-0 overflow-y-auto pr-1">
      {/* Reviews Received */}
      <div className="space-y-2">
        <h4 className="text-ds-11 sm:text-ds-13 font-semibold text-foreground uppercase tracking-wide flex items-center gap-1.5">
          <Star className="w-4 h-4" /> Reviews Received ({profileReviews.length})
        </h4>
        {profileReviews.length === 0 ? (
          <p className="text-ds-11 text-muted-foreground italic">No reviews received yet.</p>
        ) : (
          <div className="space-y-2">
            {profileReviews.map((r, i) => (
              <div key={i} className="p-3 rounded-2xl bg-secondary/30 border border-border">
                <div className="flex items-start justify-between gap-2 mb-1">
                  <div className="min-w-0">
                    <p className="text-ds-13 font-medium text-foreground">From {r.reviewer_name}</p>
                    {r.job_title && <p className="text-ds-11 text-muted-foreground line-clamp-1">on "{r.job_title}"</p>}
                  </div>
                  <div className="flex items-center gap-0.5 flex-shrink-0">
                    {Array.from({ length: 5 }).map((_, idx) => (
                      /* intentional: gold star (rating icon), not a status tone */
                      <Star key={idx} className={`w-3.5 h-3.5 ${idx < r.rating ? "fill-yellow-400 text-yellow-400" : "text-muted-foreground/30"}`} />
                    ))}
                  </div>
                </div>
                {r.feedback && <p className="text-ds-11 text-muted-foreground whitespace-pre-wrap">{r.feedback}</p>}
                {r.created_at && <p className="text-muted-foreground text-ds-11 mt-1">{formatShortDate(r.created_at)}</p>}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Reviews Left */}
      <div className="space-y-2">
        <h4 className="text-ds-11 sm:text-ds-13 font-semibold text-foreground uppercase tracking-wide flex items-center gap-1.5">
          <Star className="w-4 h-4" /> Reviews Left ({profileReviewsLeft.length})
        </h4>
        {profileReviewsLeft.length === 0 ? (
          <p className="text-ds-11 text-muted-foreground italic">Hasn't left any reviews yet.</p>
        ) : (
          <div className="space-y-2">
            {profileReviewsLeft.map((r, i) => (
              <div key={i} className="p-3 rounded-2xl bg-secondary/30 border border-border">
                <div className="flex items-start justify-between gap-2 mb-1">
                  <div className="min-w-0">
                    <p className="text-ds-13 font-medium text-foreground">For {r.reviewee_name}</p>
                    {r.job_title && <p className="text-ds-11 text-muted-foreground line-clamp-1">on "{r.job_title}"</p>}
                  </div>
                  <div className="flex items-center gap-0.5 flex-shrink-0">
                    {Array.from({ length: 5 }).map((_, idx) => (
                      /* intentional: gold star (rating icon), not a status tone */
                      <Star key={idx} className={`w-3.5 h-3.5 ${idx < r.rating ? "fill-yellow-400 text-yellow-400" : "text-muted-foreground/30"}`} />
                    ))}
                  </div>
                </div>
                {r.feedback && <p className="text-ds-11 text-muted-foreground whitespace-pre-wrap">{r.feedback}</p>}
                {r.created_at && <p className="text-muted-foreground text-ds-11 mt-1">{formatShortDate(r.created_at)}</p>}
              </div>
            ))}
          </div>
        )}
      </div>
    </TabsContent>
  );
}
