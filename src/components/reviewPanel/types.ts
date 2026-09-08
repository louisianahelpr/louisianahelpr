// Only render image URLs whose scheme we control. Local previews are
// `blob:` (createObjectURL) and stored review photos are `https:` Supabase
// public URLs — anything else (e.g. a `javascript:`/`data:` value smuggled
// into a stored photo_urls row) is dropped rather than handed to the DOM.
export const safeImageSrc = (url: string): string | undefined => {
  try {
    const scheme = new URL(url, window.location.origin).protocol;
    return scheme === "blob:" || scheme === "https:" || scheme === "http:"
      ? url
      : undefined;
  } catch {
    return undefined;
  }
};

export interface ReviewFormProps {
  open: boolean;
  onClose: () => void;
  jobId: string;
  revieweeId: string;
  revieweeName: string;
  /**
   * May THIS reviewer tip the person they just reviewed?
   *
   * Only the poster can — `create-payment` action=tip refuses anyone else
   * outright ("Only the customer can tip the helper", create-payment:785).
   * The same form serves both directions, so without this flag a HELPER who
   * gave the poster 5 stars was shown "Send <poster> a tip?" and walked into
   * a dialog that can only fail, offering to pay money up the wrong side of
   * the marketplace. Defaults to false so a new mount cannot re-open that by
   * omission.
   */
  canTip?: boolean;
  /**
   * WHICH SIDE OF THE JOB THE PERSON BEING REVIEWED WAS ON.
   *
   * The star rating is one overall number in both directions; this now steers
   * only the one-tap tags, which still have to describe the right person.
   *
   * Not derivable from `canTip` even though the two happen to agree today:
   * that flag is about who may send money, and reading direction off it would
   * silently re-point the whole question set the day tipping rules change.
   * Defaults to "helper" — the direction the tags were written for — so an
   * unadapted caller keeps the behaviour it has always had.
   */
  revieweeRole?: RevieweeRole;
}

export type RevieweeRole = "helper" | "poster";

/**
 * ONE REPUTATION, ONE NUMBER.
 *
 * This form used to collect four stars — Overall plus Punctuality, Quality of
 * work and Communication — and for a while it collected a DIFFERENT three in
 * each direction, with the poster-facing "Promptness" question writing itself
 * into the same `punctuality` column that meant "showed up on time" when a
 * poster rated a helper. One column, two questions, one average.
 *
 * The sub-criteria had already stopped being rendered anywhere on 2026-08-30
 * (ReviewsTab, RatingBreakdown), so for a week the form was collecting three
 * write-only numbers that no screen read and that a future average could only
 * misinterpret. Owner, 2026-09-07: "One reputation, and we only do overall —
 * no punctuality etc."
 *
 * So the inputs are gone and the columns are dropped (migration
 * `*_reviews_overall_only`). What is left is one star rating, the optional
 * tags below, and free text — the same form in both directions.
 */

/**
 * The one-tap tags under the star. These stay direction-aware even though the
 * rating no longer is: "On time", "Quality work" and "Very professional"
 * describe somebody who came and did a job, and every one of them was once
 * offered to a helper describing the person who HIRED them. A tag is prose the
 * reviewer chose, not a score — it does not average into anything, so it costs
 * nothing to keep honest about who it is describing.
 */
export const HELPER_QUICK_TAGS = [
  "Great communicator",
  "On time",
  "Quality work",
  "Very professional",
  "Highly recommend",
  "Friendly & helpful",
];

export const POSTER_QUICK_TAGS = [
  "Clear instructions",
  "Job as described",
  "Approved quickly",
  "Respectful",
  "Easy to work with",
  "Would work with again",
];

export const quickTagsFor = (role: RevieweeRole): string[] =>
  role === "poster" ? POSTER_QUICK_TAGS : HELPER_QUICK_TAGS;

// Display reviews for a user
export interface ReviewListProps {
  userId: string;
}

export type Review = {
  id: string;
  rating: number;
  feedback: string | null;
  created_at: string;
  reviewer_id: string;
  photo_urls?: string[] | null;
  reviewerName?: string;
};
