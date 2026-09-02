// Shared prop/data shapes for the UserProfile section components. These
// mirror the in-page types exactly — they are lifted verbatim from
// UserProfile.tsx so the extraction is behaviour-preserving.

export type ProfileReview = {
  id: string;
  rating: number;
  punctuality: number | null;
  quality: number | null;
  communication: number | null;
  feedback: string | null;
  created_at: string;
  reviewerName: string;
  jobTitle: string;
  jobCategory: string | null;
  response_text: string | null;
  response_at: string | null;
};

export type ProfileJob = {
  id: string;
  title: string;
  status: string;
  category: string;
  budget: number;
  created_at: string;
  // No latitude/longitude. These were selected for ANOTHER user's jobs and
  // read by nothing — dead PII on the wire. Removed alongside
  // `20260831232513_address_only_when_offered`, which stops a helper who has
  // merely applied from reading a job's exact coordinates at all.
};

export type ProfileStatsShape = {
  completedJobs: number;
  avgRating: number;
  reviewCount: number;
};

/**
 * How quickly this member answers a message — the OWNER's own number, and the
 * only reply-speed figure this app is entitled to state.
 *
 * It replaces `ResponseMetrics`, whose `avgResponseHours` was
 * `avg(applications.updated_at - applications.created_at)` over applications
 * the member SUBMITTED. `created_at` is the helper applying; `updated_at` is
 * stamped by a BEFORE-UPDATE trigger on a row only the POSTER may write. So the
 * interval was the poster's latency wearing the helper's name — and, being a
 * last-touch column, not even reliably that: on prod three different helpers
 * carried the identical `updated_at` to the microsecond, the signature of one
 * bulk maintenance write, and the card rendered the distance to it as "22d",
 * "17d" and "3d" of reply time. Its sibling `acceptanceRate` is gone entirely;
 * see the note in AtAGlanceCard.
 *
 * The replacement comes from `get_my_reply_latency()`
 * (20260901005108) — median minutes from the other party's message to this
 * member's answer, over real message threads.
 */
export type ReplyLatency = {
  /**
   * Median minutes to reply. NULL below the sample floor and NULL while the
   * RPC is undeployed — never 0, which would read as "answers instantly".
   */
  medianReplyMinutes: number | null;
  /** Prompt→reply pairs behind the median, so the card can say which. */
  replySample: number;
  /**
   * FALSE for a visitor (the RPC is self-only) and FALSE while it is
   * undeployed (PGRST202). The card must not editorialise about a sample size
   * it never measured — the same guard `StatSamples.hasServerStats` carries.
   */
  measured: boolean;
};

export type CancellationRate = {
  total: number;
  cancelled: number;
  rate: number | null;
};

export type LastActiveLabel = { text: string; isLive: boolean };

export type PosterReputation = { reviewCount: number; avgRating: number };


/**
 * How much history each gated stat was computed from.
 *
 * A rate arrives as `null` from `get_public_profile_stats` whenever its sample
 * is below the floor, which is correct — "0% on time" off one data point is a
 * lie of precision. But a bare `null` cannot tell the card whether the answer
 * is "we measured nothing yet" or "this stat is broken", so the sample size
 * travels alongside it and the card says which, out loud, instead of quietly
 * dropping a cell and leaving the reader to assume the worst.
 */
export type StatSamples = {
  /** Jobs on either side of the marketplace — the cancellation denominator. */
  jobs: number;
  /** Completed jobs with a comparable scheduled start AND a recorded arrival. */
  onTime: number;
  /** Completed jobs as a helper — the revision-rate denominator. */
  revisions: number;
  /** Distinct clients who completed a job with this helper. */
  repeatClients: number;
  /** Reviews received for jobs this person posted. */
  posterReviews: number;
  /**
   * FALSE while `get_public_profile_stats` is undeployed (PGRST202). The
   * numbers on screen are then the old client-side derivations, which a
   * visitor measures as zero — so the card must not editorialise about
   * sample sizes it did not actually measure.
   */
  hasServerStats: boolean;
};
