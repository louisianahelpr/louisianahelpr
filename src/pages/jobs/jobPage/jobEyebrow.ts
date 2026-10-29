import { categoryLabels } from "@/components/job-card/activityConstants";
import { formatCategory } from "@/lib/format";
import { jobCategoryGroupOf, JOB_CATEGORY_GROUPS, sentenceCaseLabel } from "@/lib/jobCategoryGroups";

/** A label's words, lower case, plural "s" dropped, joiners ("and", "&") left out: "Pets" and "Pet care" share "pet". */
function stems(label: string): Set<string> {
  return new Set(
    label
      .toLowerCase()
      .split(/[^a-z]+/)
      .filter((w) => w.length > 1 && w !== "and")
      .map((w) => (w.length > 3 ? w.replace(/s$/, "") : w)),
  );
}

/**
 * The job page's eyebrow: "Home · Cleaning", the group then the category. When the category already says the group
 * ("Yard · Yard work", "Events · Events", "Moving and errands · Moving", "Pets · Pet care", "Auto · Auto & small
 * engine") it is the category alone (audit 2026-10-29 A2-L16). Guard: src/test/jobEyebrowNoRepeat.test.ts.
 */
export function jobEyebrow(category: string): string {
  const label = sentenceCaseLabel(categoryLabels[category] ?? formatCategory(category));
  const id = jobCategoryGroupOf(category);
  const group = !id || id === "other" ? null : JOB_CATEGORY_GROUPS.find((g) => g.id === id)?.label ?? null;
  if (!group) return label;
  const own = stems(label);
  return [...stems(group)].some((w) => own.has(w)) ? label : `${group} · ${label}`;
}
