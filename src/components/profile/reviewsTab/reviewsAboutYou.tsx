import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { unwrap } from "@/lib/supabaseResult";
import { useFeatureStatus } from "@/hooks/useFeature";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { ReviewStars } from "@/components/profile/reviewCard";
import { formatTimestamp } from "@/lib/format";
import { reviewTagLabel } from "@/lib/declutter/reviewTags";
import type { ProfileReview } from "@/hooks/useProfileTabData";

/**
 * Board 179, "Reviews about you": ONE list of every review about this member,
 * jobs and Declutter, with a filter chip per side that has any (All · N, Jobs
 * you did · N, Jobs you posted · N, Things you sold · N, Things you bought · N;
 * the board's "As a Helpr" wording names a role, so it is said by what was done).
 *
 * Declutter reviews come from declutter_visible_reviews, which applies the
 * blind rule server-side (shown once both sides reviewed, or 14 days after the
 * handover) and never returns the reviewer or the order, so a Declutter row
 * says "A buyer" / "A seller", never a name. Read only while the 'declutter'
 * switch is on for this member. Job reviewers are "First L." (formatName in
 * useProfileReviews; owner rule 2026-10-21).
 */
interface DeclutterReviewAboutYou {
  id: string;
  reviewer_side: string;
  stars: number;
  comment: string | null;
  created_at: string;
  tags: string[] | null;
}

/** The signed-in member's own Declutter reviews (You › Reviews about you). */
export function useDeclutterReviewsAboutYou() {
  const userId = useCurrentUser().user?.id;
  const declutter = useFeatureStatus("declutter");
  return useQuery({
    queryKey: ["declutter", "reviews-about-you", userId],
    enabled: !!userId && declutter.on,
    staleTime: 60_000,
    queryFn: async () =>
      (unwrap(await supabase.rpc("declutter_visible_reviews", { p_user_id: userId! })) ?? []) as DeclutterReviewAboutYou[],
  });
}

type AboutYouSide = "helpr" | "poster" | "seller" | "buyer";

interface AboutYouRow {
  key: string;
  side: AboutYouSide | null;
  rating: number;
  text: string | null;
  createdAt: string;
  /** Who wrote it: "Kyle M." (job), "A buyer" / "A seller" (Declutter, never named). */
  name: string;
  /** "hired you", "bought from you"...; null when the side is unknown. */
  relation: string | null;
  /** The job's title (job rows only). */
  about: string | null;
  tags: string[];
}

const RELATION: Record<AboutYouSide, string> = {
  helpr: "hired you",
  poster: "worked for you",
  seller: "bought from you",
  buyer: "sold to you",
};

/** "Kyle M. · hired you": the row's who line as text. */
export const whoLine = (r: Pick<AboutYouRow, "name" | "relation">) => (r.relation ? `${r.name} · ${r.relation}` : r.name);

/** Job reviews and Declutter reviews as one list, newest first. */
export function aboutYouRows(jobs: ProfileReview[], declutter: DeclutterReviewAboutYou[]): AboutYouRow[] {
  const rows: AboutYouRow[] = [
    ...jobs.map((r) => ({
      key: `job-${r.created_at}-${r.reviewerName}`,
      side: r.side,
      rating: r.rating,
      text: r.feedback,
      createdAt: r.created_at,
      name: r.reviewerName,
      relation: r.side ? RELATION[r.side] : null,
      about: r.jobTitle,
      tags: [],
    })),
    ...declutter.map((r) => {
      // reviewer_side 'buyer' = a buyer reviewed this member, who sold.
      const side: AboutYouSide | null = r.reviewer_side === "buyer" ? "seller" : r.reviewer_side === "seller" ? "buyer" : null;
      return {
        key: `declutter-${r.id}`,
        side,
        rating: r.stars,
        text: r.comment,
        createdAt: r.created_at,
        name: side === "seller" ? "A buyer" : side === "buyer" ? "A seller" : "A neighbor",
        relation: side ? RELATION[side] : null,
        about: null,
        tags: [...new Set(r.tags ?? [])].map(reviewTagLabel).filter((t): t is string => !!t),
      };
    }),
  ];
  return rows.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
}

// By what the member DID, never a role held as an identity (roleNeutralCopy).
const CHIP_LABEL: Record<AboutYouSide, string> = {
  helpr: "Jobs you did",
  poster: "Jobs you posted",
  seller: "Things you sold",
  buyer: "Things you bought",
};

export type AboutYouFilter = "all" | AboutYouSide;

/** The chips: All, then each side that has at least one review (a side with none is not offered). */
export function aboutYouChips(rows: AboutYouRow[]): { value: AboutYouFilter; label: string; count: number }[] {
  const sides: AboutYouSide[] = ["helpr", "poster", "seller", "buyer"];
  return [
    { value: "all" as const, label: "All", count: rows.length },
    ...sides.map((s) => ({ value: s, label: CHIP_LABEL[s], count: rows.filter((r) => r.side === s).length })).filter((c) => c.count > 0),
  ];
}

export function AboutYouChips({
  rows,
  value,
  onChange,
}: {
  rows: AboutYouRow[];
  value: AboutYouFilter;
  onChange: (v: AboutYouFilter) => void;
}) {
  const chips = aboutYouChips(rows);
  if (chips.length < 3) return null; // All plus one side says nothing a filter could narrow.
  return (
    <div role="group" aria-label="Filter reviews" className="min-w-0 flex gap-2 overflow-x-auto px-1 py-0.5 [scrollbar-width:none]">
      {chips.map((c) => {
        const on = c.value === value;
        return (
          <button
            key={c.value}
            type="button"
            aria-pressed={on}
            data-review-filter={c.value}
            onClick={() => onChange(c.value)}
            className={`shrink-0 rounded-full px-3.5 min-h-9 text-ds-13 font-sans font-semibold whitespace-nowrap ${on ? "btn-grad-primary text-[hsl(var(--parchment))]" : ""}`}
            style={on ? undefined : { background: "hsl(var(--card))", border: "1px solid hsl(var(--olivewood) / 0.18)", color: "hsl(var(--ink-deep))" }}
          >
            {c.label} · {c.count}
          </button>
        );
      })}
    </div>
  );
}

export function AboutYouRowCard({ row }: { row: AboutYouRow }) {
  return (
    <div data-review-row={row.key.startsWith("declutter-") ? "declutter" : ""} className="rounded-ds-md liquid-glass p-card space-y-2">
      <div className="flex items-baseline justify-between gap-3">
        {/* The name never breaks (whitespace-nowrap); the relation may wrap after it. */}
        <span data-review-who="" className="min-w-0 font-sans font-bold text-ds-13" style={{ color: "hsl(var(--ink-deep))" }}>
          <span className="whitespace-nowrap">{row.name}</span>
          {row.relation && <span className="font-semibold"> · {row.relation}</span>}
        </span>
        <span className="shrink-0 font-sans text-ds-12" style={{ color: "hsl(var(--olivewood) / 0.8)" }}>
          {formatTimestamp(row.createdAt)}
        </span>
      </div>
      <ReviewStars rating={row.rating} />
      {row.text && (
        <p className="font-sans leading-relaxed text-ds-15" style={{ color: "hsl(var(--ink-deep))" }}>
          &ldquo;{row.text}&rdquo;
        </p>
      )}
      {row.tags.length > 0 && (
        <ul className="flex flex-wrap gap-1.5" aria-label="Tags">
          {row.tags.map((t) => (
            <li key={t} data-review-tag="" className="rounded-full px-2.5 py-1 font-sans font-semibold text-ds-12" style={{ background: "hsl(var(--bark) / 0.12)", color: "hsl(var(--bark))" }}>
              {t}
            </li>
          ))}
        </ul>
      )}
      {row.about && (
        <p className="font-sans text-ds-12 [overflow-wrap:anywhere]" style={{ color: "hsl(var(--olivewood) / 0.8)" }}>
          {row.about}
        </p>
      )}
    </div>
  );
}
