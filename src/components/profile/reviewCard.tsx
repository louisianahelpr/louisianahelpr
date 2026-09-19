import { Star } from "lucide-react";
import { formatCategory } from "@/lib/format";
import { HELPER_QUICK_TAGS, POSTER_QUICK_TAGS } from "@/components/reviewPanel/types";

/**
 * THE REVIEW CARD'S SHARED PARTS — one design, one file.
 *
 * Why this file exists: the app grew two public review cards with two
 * different treatments of the same three facts. `PublicReviewWall` rendered
 * the job CATEGORY as a proper rounded-full chip; `pages/userProfile/
 * ReviewsSection` — the one a visitor actually sees on `/user/:id` — printed
 * the same value as `For: {jobTitle}` in plain muted text, with the reviewer's
 * name crammed beside the stars. Owner, 2026-09-19, looking at `/user/:id`:
 * "the reviews should show the persons name who posted it above the 5 stars …
 * this review needs to be organized better. it should also be the category
 * chip."
 *
 * So the chip is not re-drawn here, it is MOVED here, character for character,
 * from PublicReviewWall — including its `data-testid`, which that component's
 * own suite asserts. Both cards now import it, and
 * `reviewCardOneDesign.test.ts` derives the renderer inventory from source and
 * fails if a third one ever hand-rolls its own.
 *
 * Note on which star colour won: ReviewsSection paints `--accent`
 * (burnt-sienna) and so does the signed-in Reviews tab; PublicReviewWall alone
 * painted `--gold-warm`. The live surfaces set the house style, so `--accent`
 * is what the shared row uses.
 */

/** Every one-tap tag the review form can write, both directions. */
const ALL_QUICK_TAGS: readonly string[] = [...HELPER_QUICK_TAGS, ...POSTER_QUICK_TAGS];

/**
 * Pull the one-tap tags back out of the free-text comment.
 *
 * `ReviewForm.toggleQuickOption` does not store tags anywhere of their own —
 * there IS no tags column on `reviews` (verified against prod 2026-09-19) — it
 * literally does `[...prev.split(", "), option].join(", ")` and writes the
 * result into `feedback`. On prod that produces rows like
 *
 *     "Quick, careful, and came back for the pollen without fuss., On time"
 *
 * — a structured choice comma-jammed onto the end of a sentence, full stop and
 * all. The durable fix is a `tags text[]` column and a write path that stops
 * concatenating; that is a schema change and a separate decision (reported).
 * This is the display-side recovery of information the reviewer really did
 * choose, and it is deliberately conservative:
 *
 *  - only a TRAILING run of parts is considered, because that is the only
 *    place the form can append;
 *  - a part must match a known tag EXACTLY (case included) to be peeled;
 *  - whatever is left is rejoined with the same ", " it was split on, so the
 *    prose comes back byte-identical. Nothing is rewritten, summarised, or
 *    invented — no model is called and no new sentence is produced.
 */
export function splitReviewTags(feedback: string | null | undefined): {
  prose: string | null;
  tags: string[];
} {
  if (!feedback) return { prose: null, tags: [] };
  const parts = feedback.split(", ");
  let cut = parts.length;
  while (cut > 0 && ALL_QUICK_TAGS.includes(parts[cut - 1])) cut -= 1;
  // All tags and nothing else is a legitimate review — the form lets you
  // submit with no prose at all — so `prose` goes null rather than "".
  const prose = parts.slice(0, cut).join(", ").trim();
  return { prose: prose.length > 0 ? prose : null, tags: parts.slice(cut) };
}

/** The five-star display row. Not an input — see reviewPanel/StarRow for that. */
export function ReviewStars({ rating }: { rating: number }) {
  return (
    // role="img" + label: five decorative glyphs are one fact, and a screen
    // reader should hear "4 of 5 stars", not five unnamed images. ReviewsSection
    // announced nothing at all before this.
    <div role="img" aria-label={`${rating} of 5 stars`} className="flex gap-0.5 shrink-0">
      {[1, 2, 3, 4, 5].map((n) => (
        <Star
          key={n}
          aria-hidden="true"
          className={`w-3.5 h-3.5 ${
            n <= rating ? "fill-accent text-accent" : "text-muted-foreground/30"
          }`}
        />
      ))}
    </div>
  );
}

/**
 * The job category, as a chip. Renders nothing for a null category — an
 * ownerless or uncategorised job must not leave an empty pill behind.
 */
export function ReviewCategoryChip({ category }: { category: string | null | undefined }) {
  if (!category) return null;
  return (
    <span
      data-testid="public-review-category"
      className="text-ds-10 font-sans font-semibold px-2 py-0.5 rounded-full uppercase tracking-wider whitespace-nowrap"
      style={{
        background: "hsl(var(--bark) / 0.08)",
        color: "hsl(var(--bark))",
        border: "0.5px solid hsl(var(--bark) / 0.18)",
      }}
    >
      {formatCategory(category)}
    </span>
  );
}

/**
 * The reviewer's own one-tap words, as chips — the "one word or something they
 * said" highlight. Sentence case, not the category chip's uppercase: this is
 * prose a person picked, not a taxonomy label, and the two must not read as
 * the same kind of thing.
 */
export function ReviewTagChips({ tags }: { tags: string[] }) {
  if (tags.length === 0) return null;
  return (
    <div className="flex flex-wrap gap-1.5" data-testid="review-tag-chips">
      {tags.map((tag) => (
        <span
          key={tag}
          className="text-ds-11 font-sans font-semibold px-2 py-0.5 rounded-full whitespace-nowrap"
          style={{
            background: "hsl(var(--burnt-sienna) / 0.10)",
            color: "hsl(var(--burnt-sienna))",
            border: "0.5px solid hsl(var(--burnt-sienna) / 0.20)",
          }}
        >
          {tag}
        </span>
      ))}
    </div>
  );
}
