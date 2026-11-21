import { Link } from "react-router-dom";
import type { JobCategory } from "@/lib/jobCategories";
import { giftGuides as G } from "@/content/giftGuides";

/** The gift-wrapping job (owner 2026-11-18): an existing category (no new one), titled "Gift wrapping". */
const GIFT_WRAP_CATEGORY: JobCategory = "errands";

/**
 * Post a job, pre-filled, through the existing matchmaker deep link (src/lib/matchmakerLink.ts: `mm=1&cat=&t=`): it
 * opens Details with the category and title filled in, and a signed-out visitor goes through sign-up and comes back
 * (ProtectedRoute's redirect). Nothing is posted until they check it and post.
 *
 * `mm` is matchmakerLink.ts's MATCHMAKER_PARAM written out (speed 11-20): importing that module put the signed-in-pages
 * chunk, and through it signed-in code, on every guide's first load. src/test/publicPagesSkipSignedInChunks.test.ts
 * reads this path back with readMatchmakerLink, so the two cannot drift.
 */
export const GIFT_WRAP_JOB_PATH = `/post-job?${new URLSearchParams({ mm: "1", cat: GIFT_WRAP_CATEGORY, t: "Gift wrapping" }).toString()}`;

/** "No time to wrap?" (owner 2026-11-18): at the bottom of every guide, at the top of Gift Wrap & Cards. */
export function GiftGuideHelpr() {
  return (
    <aside className="gg-helpr" aria-label={G.helpr.title} data-gift-helpr="">
      <div>
        <b>{G.helpr.title}</b>
        <span>{G.helpr.body}</span>
      </div>
      <Link to={GIFT_WRAP_JOB_PATH} className="gg-helpr-btn" data-gift-helpr-post="">{G.helpr.cta}</Link>
    </aside>
  );
}
