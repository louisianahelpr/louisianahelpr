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
   * Not derivable from `canTip` even though the two happen to agree today:
   * that flag is about who may send money, and reading direction off it would
   * silently re-point the whole question set the day tipping rules change.
   * Defaults to "helper" — the direction the criteria were written for — so an
   * unadapted caller keeps the behaviour it has always had.
   */
  revieweeRole?: RevieweeRole;
}

export type RevieweeRole = "helper" | "poster";

export type CategoryKey = "rating" | "punctuality" | "quality" | "communication";

export interface CategoryRow {
  key: CategoryKey;
  label: string;
  sublabel: string;
  required: boolean;
}

/**
 * ONE FORM, TWO DIRECTIONS, TWO SETS OF QUESTIONS.
 *
 * Until 2026-09-06 this was a single array used in both directions, so a
 * HELPER rating the person who HIRED them was asked to score "Punctuality —
 * showed up on time" and "Quality of work — met expectations". Neither is a
 * fact about a poster: the poster is not the one who shows up, and there is no
 * work of theirs to judge. The asymmetry ran backwards too — the poster-facing
 * form was the MORE detailed of the two, asking four things about someone
 * three of them did not apply to.
 *
 * STORAGE IS UNCHANGED AND THERE IS NO MIGRATION. `reviews.punctuality`,
 * `.quality` and `.communication` keep exactly the meanings their names carry;
 * the poster set simply does not ask `quality`, which persists as NULL — the
 * value the column already holds for any dimension a reviewer skipped (14 of
 * prod's 20 review rows have all three; 6 have none). Two reasons not to add a
 * poster-specific column instead:
 *
 *  1. Nothing renders these. The per-category breakdown was removed from both
 *     display surfaces on 2026-08-30 (owner: "one overall rating only") — see
 *     ReviewsTab.tsx and userProfile/RatingBreakdown.tsx. A new column would be
 *     a fourth write-only field, and a migration to store something no screen
 *     reads is cost with no reader.
 *  2. `reviews` is keyed by `reviewee_id`, and one account is both poster and
 *     helper on this marketplace — so a single person's rows already mix both
 *     directions. Overloading `quality` to mean "how accurate was the job
 *     description" for one of them would make any future average over that
 *     column a blend of two different questions. Leaving it NULL keeps the
 *     column answerable.
 *
 * "Was the job as described" survives inside Communication's sublabel, which
 * is where it honestly belongs: being clear about what the job needed IS
 * communication. And a poster's promptness is real and consequential here —
 * their approval is what releases the escrowed payout — so `punctuality` keeps
 * its name and means the thing it says.
 */
export const HELPER_CATEGORY_ROWS: CategoryRow[] = [
  { key: "rating", label: "Overall", sublabel: "Your overall experience", required: true },
  { key: "punctuality", label: "Punctuality", sublabel: "Showed up on time", required: false },
  { key: "quality", label: "Quality of work", sublabel: "Met expectations", required: false },
  { key: "communication", label: "Communication", sublabel: "Clear and responsive", required: false },
];

export const POSTER_CATEGORY_ROWS: CategoryRow[] = [
  { key: "rating", label: "Overall", sublabel: "Your overall experience", required: true },
  {
    key: "punctuality",
    label: "Promptness",
    // The poster's approval is the step that flips escrow to payout_pending,
    // so "did they confirm quickly" is the single most consequential thing one
    // helper can tell another about a poster — it is literally how fast they
    // get paid.
    sublabel: "Confirmed the work and released payment quickly",
    required: false,
  },
  {
    key: "communication",
    label: "Communication",
    sublabel: "Clear about the job, and easy to reach",
    required: false,
  },
];

export const categoryRowsFor = (role: RevieweeRole): CategoryRow[] =>
  role === "poster" ? POSTER_CATEGORY_ROWS : HELPER_CATEGORY_ROWS;

/**
 * The one-tap tags under the stars. Direction-aware for the same reason as the
 * rows above: "On time", "Quality work" and "Very professional" describe
 * somebody who came and did a job, and every one of them was offered to a
 * helper describing the person who hired them.
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
  punctuality: number | null;
  quality: number | null;
  communication: number | null;
  feedback: string | null;
  created_at: string;
  reviewer_id: string;
  photo_urls?: string[] | null;
  reviewerName?: string;
};
