/**
 * TrustRow — a compact horizontal strip of trust signals for a user profile.
 *
 * Renders only the chips that have real data — never empty or zero-value chips.
 * Chips are separated by a dot that inherits the row's own ink (see DOT below).
 *
 * Usage:
 *   <TrustRow idVerified completedJobs={12} avgRating={4.9} repeatHirePercent={50} />
 */

interface TrustRowProps {
  /** Show "ID Verified" chip when true */
  idVerified?: boolean;
  /** Show "N jobs done" when N > 0 */
  completedJobs?: number;
  /** Show "N.N★" when present and > 0 */
  avgRating?: number | null;
  /** Used alongside avgRating, shown as "(N)" */
  reviewCount?: number;
  /** Show "repeat hire" when ≥ 25% */
  repeatHirePercent?: number;
  className?: string;
}

/**
 * THE SEPARATOR HAS NO COLOUR OF ITS OWN. It used to be
 * `hsl(var(--burnt-sienna) / 0.35)` — 1.77:1 on a white card, 1.62:1 on a dark
 * one, against a 4.5:1 AA floor. Same class of defect, and the same remedy, as
 * EarningHistory's dot (92d448a8d): the glyph inherits the row it punctuates
 * (`hsl(var(--olivewood) / 0.8)`, set on the wrapper below — 7.11:1 light,
 * 7.14:1 dark) instead of carrying a tint nobody would have picked on purpose.
 *
 * Sienna could not have been kept at ANY alpha: measured ladder on the dark
 * card, 0.35 → 1.62, 0.7 → 2.87, 0.85 → 3.63, 1.0 → 4.53. Only full-strength
 * sienna clears, and a full-strength orange dot between two quiet uppercase
 * chips shouts louder than the chips themselves.
 *
 * `aria-hidden` stays — it is independently right; a screen reader announcing a
 * bare "·" between "ID Verified" and "12 jobs done" is noise — but it does NOT
 * clear the contrast gate on its own: axe's colour-contrast rule matches visual
 * visibility, not the accessibility tree.
 */
const DOT = <span aria-hidden>·</span>;

export function TrustRow({
  idVerified,
  completedJobs,
  avgRating,
  reviewCount,
  repeatHirePercent,
  className,
}: TrustRowProps) {
  const chips: React.ReactNode[] = [];

  if (idVerified) {
    chips.push(
      <span key="id">
        ✓ ID Verified
      </span>,
    );
  }

  if (completedJobs != null && completedJobs > 0) {
    chips.push(
      <span key="jobs">{completedJobs} {completedJobs === 1 ? "job" : "jobs"} done</span>,
    );
  }

  if (avgRating != null && avgRating > 0) {
    chips.push(
      <span key="rating">
        {/* The glyph is decoration: on its own AT reads "4.9 black star".
            Hide it and say what the number means. */}
        {avgRating.toFixed(1)}
        <span aria-hidden>★</span>
        <span className="sr-only"> star rating</span>
        {reviewCount != null && reviewCount > 0 && (
          <span style={{ color: "hsl(var(--olivewood) / 0.8)" }}> ({reviewCount})</span>
        )}
      </span>,
    );
  }

  if (repeatHirePercent != null && repeatHirePercent >= 25) {
    chips.push(<span key="repeat">Repeat hire</span>);
  }

  if (chips.length === 0) return null;

  return (
    <div
      className={[
        "flex items-center gap-1.5 flex-wrap",
        "text-ds-10 font-sans font-semibold uppercase",
        className ?? "",
      ]
        .filter(Boolean)
        .join(" ")}
      style={{
        color: "hsl(var(--olivewood) / 0.8)",
        letterSpacing: "0.06em",
      }}
    >
      {chips.map((chip, i) => (
        <span key={i} className="inline-flex items-center gap-1.5">
          {i > 0 && DOT}
          {chip}
        </span>
      ))}
    </div>
  );
}
