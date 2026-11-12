/**
 * The shop's category in one tap (audit 11-10 F7): the most common kinds of shop first as buttons, then "More" for the
 * full two-step list (the fixed list, L54). A category outside the common few opens straight into the full list with
 * it chosen. The value is the category's own slug, as before.
 */
import { useState } from "react";
import { cn } from "@/lib/utils";
import { TwoStepCategoryPicker } from "@/components/ui/TwoStepCategoryPicker";

/** The common kinds of shop (audit 11-10 F7: bakery, crafts, plants, cleaning, ...). Only those on the server's list show. */
const COMMON_SHOP_CATEGORIES = ["bakery", "crafts_gifts", "plants_garden", "cleaning", "lawn_landscaping"] as const;

interface Group { slug: string; label: string; items: { slug: string; label: string }[] }

export function ShopCategoryQuickPick({ id, value, onChange, groups, invalid, describedBy }: {
  id: string;
  value: string;
  onChange: (slug: string) => void;
  groups: Group[];
  invalid?: boolean;
  describedBy?: string;
}) {
  const all = groups.flatMap((g) => g.items);
  const common = COMMON_SHOP_CATEGORIES.map((slug) => all.find((c) => c.slug === slug)).filter((c): c is Group["items"][number] => !!c);
  const isCommon = common.some((c) => c.slug === value);
  const [more, setMore] = useState(!!value && !isCommon);
  const showMore = more || (!!value && !isCommon);

  return (
    <div className="space-y-2">
      <div id={id} tabIndex={-1} role="radiogroup" aria-label="Category" aria-invalid={invalid || undefined} aria-describedby={describedBy}
        className="flex flex-wrap gap-2">
        {common.map((c) => {
          const on = value === c.slug;
          return (
            <button key={c.slug} type="button" role="radio" aria-checked={on}
              className={cn("min-h-11 rounded-full border px-4 text-ds-13", on ? "btn-grad-primary border-transparent" : "border-border bg-card text-foreground")}
              onClick={() => { setMore(false); onChange(c.slug); }}>
              {c.label}
            </button>
          );
        })}
        <button type="button" aria-expanded={showMore}
          className={cn("min-h-11 rounded-full border px-4 text-ds-13", showMore ? "border-primary text-foreground" : "border-border bg-card text-foreground")}
          onClick={() => setMore((m) => !m)}>
          More
        </button>
      </div>
      {showMore && <TwoStepCategoryPicker id={`${id}-more`} value={isCommon ? "" : value} onChange={onChange} groups={groups} placeholder="Choose another category" />}
    </div>
  );
}
