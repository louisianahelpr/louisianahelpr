/**
 * "Neighbors say" (Direction A, owner 11-10; D011: the landing had no social proof). Real reviews from finished jobs,
 * as a DATED RECORD, not a live read: every published review on prod whose job, reviewer and reviewee are not test
 * accounts (read-only SQL, 2026-11-10: four reviews, all 5 stars, all yard work, two in Iberia and two in Vermilion).
 * Each shows the stars, the words the reviewer chose (the review's own quick tags) and the job type and parish.
 *
 * NO names and NO faces: a member's name or photo needs that member's OK (owner 11-10), and there is no consent record
 * yet. When consents exist, a first name and town can join each quote; until then, the stars, the words and the place.
 * Replace this list with newer real reviews as they come in; never write one by hand.
 */
type NeighborReview = { stars: 5 | 4; words: string; who: string; job: string; place: string; reviewed: string };

export const NEIGHBOR_REVIEWS: readonly NeighborReview[] = [
  { stars: 5, words: "Would hire again", who: "The neighbor who hired", job: "Yard work", place: "Iberia Parish", reviewed: "2026-10-23" },
  { stars: 5, words: "Quality work", who: "The neighbor who hired", job: "Yard work", place: "Vermilion Parish", reviewed: "2026-10-08" },
  { stars: 5, words: "Friendly, clear about the job, paid fast, would work again", who: "The Helpr who did it", job: "Yard work", place: "Iberia Parish", reviewed: "2026-10-22" },
];

export function NeighborsSay() {
  return (
    <section aria-labelledby="landing-neighbors-title" data-testid="landing-neighbors" className="px-5 sm:px-8 lg:px-12 pt-12 pb-10 lg:pt-20 lg:pb-14">
      <div className="mx-auto w-full max-w-6xl flex flex-col gap-8">
        <h2 id="landing-neighbors-title" className="font-display landing-serif landing-h2" style={{ color: "var(--lp-ink)" }}>
          Neighbors say
        </h2>
        {/* D007 (11-10): not another white card each; a quote with a rule beside it. */}
        <ul className="grid grid-cols-1 sm:grid-cols-3 gap-6 lg:gap-10">
          {NEIGHBOR_REVIEWS.map((r) => (
            <li key={r.words} className="flex flex-col gap-2 border-l-2 pl-4 min-w-0" style={{ borderColor: "var(--lp-action)" }} data-review="">
              <span role="img" aria-label={`${r.stars} stars`} className="text-ds-16" style={{ color: "var(--lp-money)" }}>
                {"★".repeat(r.stars)}
              </span>
              <blockquote className="landing-serif-text text-ds-20 leading-snug" style={{ color: "var(--lp-ink)" }}>
                “{r.words}”
              </blockquote>
              <p className="text-ds-14" style={{ color: "var(--lp-body)" }}>
                {r.who}. {r.job}, {r.place}.
              </p>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
