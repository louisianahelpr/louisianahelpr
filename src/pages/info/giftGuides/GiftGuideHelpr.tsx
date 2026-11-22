import { Link } from "react-router-dom";
import type { JobCategory } from "@/lib/jobCategories";
import { giftGuides as G } from "@/content/giftGuides";

/** The gift-wrapping job (owner 2026-11-18): an existing category (no new one), titled "Gift wrapping". */
const GIFT_WRAP_CATEGORY: JobCategory = "errands";

/**
 * The starter description (holiday audit 1121 #42): without one the form opened on an empty box, "Add a description to
 * continue" and the errands tips ("Which stores or locations?"), which do not fit wrapping. It is over 100 characters,
 * so the errands tips stay hidden, and it has no [bracketed] fill-ins, so it never blocks Continue. Editable as usual.
 */
export const GIFT_WRAP_DESCRIPTION =
  "Looking for help wrapping holiday gifts at my home. I have the paper, tape and ribbon ready, and I'll share how many gifts there are and a good time.";

/**
 * Post a job, pre-filled, through the existing matchmaker deep link (src/lib/matchmakerLink.ts: `mm=1&cat=&t=&d=`):
 * it opens Details with the category, title and a starter description filled in. A signed-out visitor opens the form
 * directly (guests post first, then sign up to send it). Nothing is posted until they check it and post.
 *
 * `mm` is matchmakerLink.ts's MATCHMAKER_PARAM written out (speed 11-20): importing that module put the signed-in-pages
 * chunk, and through it signed-in code, on every guide's first load. src/test/publicPagesSkipSignedInChunks.test.ts
 * reads this path back with readMatchmakerLink, so the two cannot drift.
 */
export const GIFT_WRAP_JOB_PATH = `/post-job?${new URLSearchParams({ mm: "1", cat: GIFT_WRAP_CATEGORY, t: "Gift wrapping", d: GIFT_WRAP_DESCRIPTION }).toString()}`;

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
