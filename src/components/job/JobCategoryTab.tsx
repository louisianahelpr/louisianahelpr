import { categoryColors, categoryLabels } from "@/components/job-card/activityConstants";
import { wordInLang } from "@/lib/i18n/inLang";
import { CategoryIcon } from "@/components/job/CategoryIcon";
import { formatCategory } from "@/lib/format";
import { jobCategoryTint } from "@/lib/jobCategoryTint.mjs";

/**
 * JobCategoryTab — the corner tab that names a job's category.
 *
 * ONE definition of the shape that hangs off a job card's top-left corner:
 * squared on the left so it continues the category rail with no seam, a
 * rounded nose on the right (`rounded-l-none rounded-br-lg rounded-tr-none`),
 * the category's own `badge` palette, a 10px icon and a 10px semibold label.
 *
 * It was drawn by hand, identically, in TWO files — `activity/JobCardShell`
 * (My Posts / My Jobs) and `dashboard/JobCard` (the Browse feed) — which is
 * the thing the owner asked about directly ("is this all one component? if
 * not fix it"). The class strings had already started to drift: only the feed
 * copy carried the `min-w-0 max-w-[52%] truncate` cap that keeps a long
 * category ("Furniture Assembly") from eating the badges beside it.
 *
 * That cap is the `flexible` prop, and it is OFF by default — it only makes
 * sense in the feed card's flex badge row, where the tab shares a line with the
 * status corner and the secondary chip and is the item that must yield. The
 * activity cards absolutely position this tab over the card corner, where the
 * percentage resolves against a shrink-to-fit box: applying it there truncated
 * every label to its first letter ("C", "P", "Y…"). That was caught in a 375
 * screenshot of /posts, and it is exactly the drift a careless
 * "extract the common case" ships.
 *
 * The tab is positioned by its CALLER, not by itself. This component owns the
 * tab's own look and nothing about where it sits.
 */
export function JobCategoryTab({
  category,
  flexible = false,
  icon = true,
  tinted = false,
  className,
}: {
  /** Job category key, e.g. "cleaning". Unknown keys fall back to "other". */
  category: string;
  /**
   * Let the LABEL truncate so the tab yields width to the chips beside it.
   * For a tab laid out in a flex row (the Browse feed card) — never for one
   * absolutely positioned over a card corner, where `max-w-%` has no sensible
   * containing width.
   */
  flexible?: boolean;
  /**
   * Draw the small category icon before the label. Off on a Browse feed ROW (owner 2026-11-17), whose thumbnail tile
   * already shows the category icon, so the row drew it twice.
   */
  icon?: boolean;
  /**
   * Colour the label with the category's tile tint (the row thumbnail's icon colour). On a Browse feed ROW (owner
   * 2026-11-27: "hard to tell the difference between location, category, time, day"), so the category reads apart from
   * the grey place, day and time beside it.
   */
  tinted?: boolean;
  className?: string;
}) {
  const catStyle = categoryColors[category] ?? categoryColors.other;
  // Owner 2026-10-18 (tweak 3, "simpler job cards"): a small coloured icon +
  // plain label, no coloured tab. `flexible` still lets the label truncate.
  return (
    <span
      className={`job-cat-label inline-flex items-center gap-1.5 min-w-0 text-ds-11 font-semibold text-muted-foreground${flexible ? " max-w-[52%]" : ""}${className ? ` ${className}` : ""}`}
      style={tinted ? { color: jobCategoryTint(category).color } : undefined}
    >
      {icon && (
        <CategoryIcon
          category={category}
          aria-hidden
          className={`w-3.5 h-3.5 shrink-0 ${catStyle.title}`}
        />
      )}
      <span className="font-sans truncate">
        {/* Design audit r2 #33: the name in the reader's language. */}
        {wordInLang(`jc.${category}`, categoryLabels[category] || formatCategory(category))}
      </span>
    </span>
  );
}
