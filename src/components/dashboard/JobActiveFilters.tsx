/**
 * Jobs Browse's "filters on" row (owner 11-25: "move the category chips into the filter bc they take up too much space
 * here"). The All / Home / Yard / Moving & errands chip row left Browse; a category is picked in the Filters sheet,
 * where Category is the first section (buildJobFilterSections). What stays on the page is what is ON, each as one small
 * removable chip ("Home ×", "Saved ×"), the same RemoveFilterChip Declutter's row wears (DeclutterActiveFilters), so
 * a chosen category is still visible and one tap clears it. Nothing is drawn while nothing is on.
 * Guard: src/test/phoneCompactBrowse1125.test.tsx.
 */
import { RemoveFilterChip } from "@/components/ui/RemoveFilterChip";
import { wordInLang } from "@/lib/i18n/inLang";
import { categoryFilterLabel, isJobCategoryGroupId } from "@/lib/jobCategoryGroups";

/** The chip's words for a category filter value: Post a job's group title (Spanish via es.ts), else the one category. */
function jobCategoryPillLabel(value: string): string {
  return isJobCategoryGroupId(value) ? wordInLang(`postJob.group.${value}`, categoryFilterLabel(value)) : categoryFilterLabel(value);
}

export function JobActiveFilters({ category, onClearCategory, savedOn = false, onClearSaved }: {
  /** The feed's category filter (a group id, or a legacy single category), or null. */
  category: string | null;
  onClearCategory: () => void;
  /** The feed's "Only saved jobs" filter. */
  savedOn?: boolean;
  onClearSaved?: () => void;
}) {
  const pills: { key: string; label: string; clear: () => void }[] = [];
  if (category) pills.push({ key: "category", label: jobCategoryPillLabel(category), clear: onClearCategory });
  if (savedOn && onClearSaved) pills.push({ key: "saved", label: wordInLang("section.chipSaved", "Saved"), clear: onClearSaved });
  if (pills.length === 0) return null;
  return (
    <ul aria-label={wordInLang("decl.filtersOn", "Filters on")} data-active-filters="jobs" className="flex flex-wrap gap-2 pb-1">
      {pills.map((p) => (
        <li key={p.key}>
          <RemoveFilterChip
            data-active-filter={p.key}
            aria-label={wordInLang("decl.removeFilter", `Remove filter: ${p.label}`, { label: p.label })}
            onClick={p.clear}
          >
            {p.label}
          </RemoveFilterChip>
        </li>
      ))}
    </ul>
  );
}
