import { Star } from "lucide-react";
import { CategoryIcon } from "@/components/job/CategoryIcon";
import { categoryLabels } from "@/components/job-card/activityConstants";
import UserAvatar from "@/components/UserAvatar";
import { STAR_ON } from "@/lib/starColor";
import { jobCategoryTint } from "@/lib/jobCategoryTint.mjs";

/** Shared with the pre-boot Browse shell (src/lib/browseShellCards.mjs), which must match byte for byte. */
// The row and its text column live in cardGeometry.ts so JobCardSkeleton (eager) can use them without this module.
export { JOB_CARD_MEDIA_ROW, JOB_CARD_TEXT_COL } from "@/components/job/cardGeometry";
import { JOB_ROW_MEDIA } from "@/components/job/cardGeometry";
export const JOB_CARD_MEDIA_PAD = "pl-3 pt-3 pb-3";
// Owner 2026-11-17 (signed-in tweaks, item 5): 48 px (was 56) and a soft per-category tint (src/lib/jobCategoryTint.mjs).
// Owner 11-25 (compact rows): 40 px (JOB_ROW_MEDIA, cardGeometry.ts).
const JOB_CARD_MEDIA = JOB_ROW_MEDIA;
const JOB_CARD_FACE_ROW = "mt-1 flex h-5 items-center gap-1.5 min-w-0 text-ds-11 text-muted-foreground";

/**
 * Photo-first job cards (owner 2026-10-17, Q2043 + Q2036): every Browse card
 * leads with a picture. The job's OWN first photo when it has one; otherwise
 * the category image, a soft tile in the category's own tint carrying its icon (the
 * owner's "category image when a job has no photo"). Never a stock photo, and
 * never a grey empty block: the tile is a fixed small square beside the text,
 * so a job without a photo costs no extra height (lead review 2026-10-21).
 *
 * Fixed size at every width, so every card in the feed stays the same height
 * (owner: "all job cards should remain same size always").
 */
export function JobCardMedia({ photo, category }: { photo: string | null | undefined; category: string }) {
  const label = categoryLabels[category] ?? categoryLabels.other ?? "Job";
  const tint = jobCategoryTint(category);
  return (
    <div
      data-testid="job-card-media"
      data-media={photo ? "photo" : "category"}
      className={JOB_CARD_MEDIA}
      style={photo ? undefined : { background: tint.background }}
    >
      {photo ? (
        <img loading="lazy" decoding="async" src={photo} alt="" className="absolute inset-0 h-full w-full object-cover" />
      ) : (
        <span className="absolute inset-0 flex items-center justify-center" role="img" aria-label={label}>
          <CategoryIcon category={category} aria-hidden className="w-5 h-5" style={{ color: tint.color }} />
        </span>
      )}
    </div>
  );
}

/**
 * The poster's face on the card: photo (or initials on a colour circle),
 * first name and their rating when they have one. Hidden when the feed has no
 * real name for the poster (guest reads, a deleted account).
 */
export function JobCardPosterFace({
  posterId,
  name,
  avatarUrl,
  avgRating,
  reviewCount,
  flexibleTag = false,
}: {
  /** Phone polish C (11-25): a row moves "Flexible" off its one meta line ("1 PM · Flexib" cut at 375) to a small tag here.
   *  One word, "Flexible", as signed out (polish audit 11-27 #3). */
  flexibleTag?: boolean;
  posterId: string | null | undefined;
  name: string | null | undefined;
  avatarUrl: string | null | undefined;
  avgRating: number | null | undefined;
  reviewCount: number | null | undefined;
}) {
  const first = (name ?? "").trim().split(/\s+/)[0] ?? "";
  // The row always holds its 20px, named or not, so every card (and the
  // pre-boot Browse shell, which never carries a name) is the same height.
  const tag = flexibleTag ? (
    <span data-flexible-tag="" className="shrink-0 rounded-full border border-border px-1.5 text-ds-10 font-semibold leading-4 text-muted-foreground">Flexible</span>
  ) : null;
  if (!first || name === "a neighbor") return tag ? <div data-testid="job-card-poster" className={JOB_CARD_FACE_ROW}>{tag}</div> : <div data-testid="job-card-poster" aria-hidden className={JOB_CARD_FACE_ROW} />;
  const rated = (reviewCount ?? 0) > 0 && (avgRating ?? 0) > 0;
  return (
    <div data-testid="job-card-poster" className={JOB_CARD_FACE_ROW}>
      <UserAvatar userId={posterId} src={avatarUrl} name={name} pixelSize={40} className="h-5 w-5 shrink-0" />
      <span className="truncate font-sans font-medium text-foreground/80">{first}</span>
      {rated && (
        <span role="img" className="inline-flex shrink-0 items-center gap-0.5" aria-label={`rated ${(avgRating ?? 0).toFixed(1)} from ${reviewCount} reviews`}>
          <Star aria-hidden className="w-2.5 h-2.5 shrink-0" style={{ color: STAR_ON, fill: STAR_ON }} />
          <span className="font-sans">{(avgRating ?? 0).toFixed(1)}</span>
        </span>
      )}
      {tag}
    </div>
  );
}
