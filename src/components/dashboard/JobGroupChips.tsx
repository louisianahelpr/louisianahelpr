import { JOB_CATEGORY_GROUPS, jobCategoryGroupOf, type JobCategoryGroupId } from "@/lib/jobCategoryGroups";
import { hapticLight } from "@/lib/haptics";
import { chipStyles } from "./JobFilters";

/**
 * Board 6 (spec v2 §10 "Jobs: Browse"): under the search pill, a chip row of
 * category GROUPS, "All" first. A group with one category picks it at once; a
 * bigger group opens its sub-chips below (Home → Cleaning, Handyman, …), and a
 * sub-chip picks that category.
 *
 * It drives the ONE category filter the feed already has (`selectedCategory`,
 * the same value the filter sheet's Category section, the header count, the
 * map pins and saved searches read), so a chip can never narrow the list in a
 * way the rest of the screen does not know about. A group is "on" while the
 * picked category sits in it.
 */
export function JobGroupChips({
  selectedCategory,
  setSelectedCategory,
  openGroup,
  setOpenGroup,
}: {
  selectedCategory: string | null;
  setSelectedCategory: (v: string | null) => void;
  /** The group whose sub-chips show; lifted so it survives the feed re-rendering. */
  openGroup: JobCategoryGroupId | null;
  setOpenGroup: (g: JobCategoryGroupId | null) => void;
}) {
  const { chipBase, chipActive, chipIdle } = chipStyles;
  const pickedGroup = selectedCategory ? jobCategoryGroupOf(selectedCategory) : null;
  const shownGroup = openGroup ?? pickedGroup;
  const sub = JOB_CATEGORY_GROUPS.find((g) => g.id === shownGroup && g.items.length > 1);
  // On the page (not inside the sheet) every control is a 44px tap target (home-chrome smallTapTargets).
  const chip = (on: boolean) => `${chipBase.replace("min-h-10", "min-h-11")} shrink-0 ${on ? chipActive : chipIdle}`;

  return (
    <div className="flex flex-col gap-2 pb-2 lg:px-4">
      <div role="group" aria-label="Job groups" className="flex gap-2 overflow-x-auto scrollbar-hide">
        <button
          type="button"
          aria-pressed={!selectedCategory && !openGroup}
          className={chip(!selectedCategory && !openGroup)}
          onClick={() => {
            hapticLight();
            setOpenGroup(null);
            setSelectedCategory(null);
          }}
        >
          All
        </button>
        {JOB_CATEGORY_GROUPS.map((g) => {
          const on = shownGroup === g.id;
          return (
            <button
              key={g.id}
              type="button"
              aria-pressed={on}
              aria-expanded={g.items.length > 1 ? on : undefined}
              className={chip(on)}
              onClick={() => {
                hapticLight();
                if (g.items.length === 1) {
                  setOpenGroup(null);
                  setSelectedCategory(on ? null : g.items[0].value);
                  return;
                }
                // A second tap on an open group closes it and drops its pick.
                if (on) {
                  setOpenGroup(null);
                  if (pickedGroup === g.id) setSelectedCategory(null);
                  return;
                }
                setOpenGroup(g.id);
                if (pickedGroup && pickedGroup !== g.id) setSelectedCategory(null);
              }}
            >
              {g.label}
            </button>
          );
        })}
      </div>
      {sub && (
        <div role="group" aria-label={`${sub.label} jobs`} className="flex flex-wrap gap-2">
          {sub.items.map((c) => {
            const on = selectedCategory === c.value;
            return (
              <button
                key={c.value}
                type="button"
                aria-pressed={on}
                className={chip(on)}
                onClick={() => {
                  hapticLight();
                  setSelectedCategory(on ? null : c.value);
                }}
              >
                {c.label}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
