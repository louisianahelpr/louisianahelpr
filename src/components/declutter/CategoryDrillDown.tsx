/**
 * The Sell form's category picker as a drill-down (owner 11-07, after reviewing Vinted; our own look): a search box
 * on top, then the headings, each with its icon; tapping a heading shows only its categories, with a way back; a
 * search lists every matching category straight away, with its heading beside it. Choosing one sets the category.
 *
 * Our list has two levels (heading, then the category stored on the item: src/lib/declutter/categoryIcons.ts), so
 * the drill-down is heading -> category; a category IS the leaf. No field is added (the 11-01 six-field design).
 * Rows are the shared ListRow (44px floor, the sanctioned tint and focus ring).
 *
 * Guard: src/test/declutterCategoryDrillDown.test.tsx.
 */
import { useId, useMemo, useState } from "react";
import { Check, ChevronLeft, ChevronRight, Search, X } from "lucide-react";
import { FieldClearButton } from "@/components/ui/FieldClearButton";
import { Input } from "@/components/ui/input";
import { ListRow } from "@/components/ui/ListRow";
import { CATEGORY_GROUP_ICON, CATEGORY_LABEL, categoryIcon, type CategoryGroupHeading } from "@/lib/declutter/categoryIcons";
import "@/lib/i18n/enDeclutter";
import "@/lib/i18n/enSellForm";
import type { MsgKey } from "@/lib/i18n/en";
import { t, useLanguage } from "@/lib/i18n/language";

/** Each heading's words key (F260q). The heading itself stays the English value the category list is keyed by. */
const HEADING_KEY: Record<CategoryGroupHeading, MsgKey> = {
  Home: "sf.group.home",
  Outdoors: "sf.group.outdoors",
  Family: "sf.group.family",
  "Hobbies and fun": "sf.group.hobbies",
  More: "sf.group.more",
};
const headingWords = (h: CategoryGroupHeading) => t(HEADING_KEY[h]);
/** A category's shown name, in the member's language (the browse filter's decl.cat.* words). */
const catWords = (k: string) => (CATEGORY_LABEL[k] ? t(`decl.cat.${k}` as MsgKey) : k);

interface Props {
  label: string;
  groups: { heading: CategoryGroupHeading; values: string[] }[];
  value: string;
  onChange: (category: string) => void;
}

/** Lower-case, no accents or punctuation, so "toys & games" finds "Toys and games" and "jardin" finds "jardín". */
function words(s: string): string {
  return s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/&/g, " and ").replace(/[^a-z0-9 ]+/g, " ").replace(/\s+/g, " ").trim();
}

export function CategoryDrillDown({ label, groups, value, onChange }: Props) {
  const searchId = useId();
  const lang = useLanguage();
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState<CategoryGroupHeading | null>(null);
  const q = words(query);

  const matches = useMemo(() => {
    if (!q) return [];
    return groups.flatMap((g) =>
      g.values
        // The English words always find it; a Spanish reader's own words too.
        .filter((k) => words(`${CATEGORY_LABEL[k] ?? k} ${g.heading} ${catWords(k)} ${headingWords(g.heading)}`).includes(q))
        .map((k) => ({ key: k, heading: headingWords(g.heading) })),
    );
  }, [groups, q, lang]); // lang: the shown words change with the language

  const leaf = (k: string, heading?: string) => {
    const Icon = categoryIcon(k);
    const on = k === value;
    return (
      <li key={k}>
        <ListRow
          aria-pressed={on}
          data-category-leaf={k}
          onClick={() => onChange(k)}
          trailing={on ? <Check className="h-4 w-4 shrink-0 text-primary" aria-hidden /> : null}
          className="text-ds-15"
        >
          <span className="flex min-w-0 items-center gap-3">
            <Icon className="h-5 w-5 shrink-0 text-muted-foreground" aria-hidden />
            <span className="min-w-0">
              <span className={`block truncate ${on ? "font-semibold text-foreground" : "text-foreground"}`} title={catWords(k)}>{catWords(k)}</span>
              {heading && <span className="block truncate text-ds-13 text-muted-foreground" title={heading}>{heading}</span>}
            </span>
          </span>
        </ListRow>
      </li>
    );
  };

  const openGroup = open ? groups.find((g) => g.heading === open) ?? null : null;

  return (
    <div className="space-y-2" role="group" aria-label={label} data-category-drilldown={q ? "search" : openGroup ? openGroup.heading : "top"}>
      <p className="text-ds-14 font-semibold text-foreground">{label}</p>
      <div className="relative">
        <Search className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
        <Input
          look="card"
          id={searchId}
          type="search"
          aria-label={t("sf.catSearch")}
          placeholder={t("sf.catSearch")}
          autoComplete="off"
          enterKeyHint="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          className="pl-10 pr-11 [&::-webkit-search-cancel-button]:hidden"
        />
        {/* Q913: every search field has its own clear; the shared ✕ (FieldClearButton). */}
        {query && (
          <FieldClearButton aria-label={t("sf.clearSearch")} onClick={() => setQuery("")} className="right-2.5 rounded-full">
            <X className="h-4 w-4" aria-hidden />
          </FieldClearButton>
        )}
      </div>
      <div className="rounded-2xl border border-border bg-card p-1">
        {q ? (
          matches.length ? (
            <ul aria-label={t("sf.catMatches")}>{matches.map((m) => leaf(m.key, m.heading))}</ul>
          ) : (
            <p className="px-3 py-3 text-ds-14 text-muted-foreground" role="status">
              {t("sf.catNoMatch", { q: query.trim() })}
            </p>
          )
        ) : openGroup ? (
          <>
            <ListRow onClick={() => setOpen(null)} className="justify-start gap-2 text-ds-14 font-semibold text-muted-foreground" data-category-back="">
              <ChevronLeft className="h-4 w-4 shrink-0" aria-hidden />
              {t("sf.allCats")}
            </ListRow>
            <p className="px-3 pb-1 pt-2 text-ds-13 font-semibold text-foreground">{headingWords(openGroup.heading)}</p>
            <ul aria-label={headingWords(openGroup.heading)}>{openGroup.values.map((k) => leaf(k))}</ul>
          </>
        ) : (
          <ul aria-label={t("sf.catHeadings")}>
            {groups.map((g) => {
              const Icon = CATEGORY_GROUP_ICON[g.heading];
              const chosenHere = g.values.includes(value) ? catWords(value) : null;
              const heading = headingWords(g.heading);
              return (
                <li key={g.heading}>
                  <ListRow
                    onClick={() => setOpen(g.heading)}
                    data-category-heading={g.heading}
                    aria-label={chosenHere ? t("sf.headingChosen", { heading, category: chosenHere }) : heading}
                    trailing={<ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />}
                    className="text-ds-15"
                  >
                    <span className="flex min-w-0 items-center gap-3">
                      <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-muted text-foreground">
                        <Icon className="h-5 w-5" aria-hidden />
                      </span>
                      <span className="min-w-0">
                        <span className="block truncate font-semibold text-foreground" title={heading}>{heading}</span>
                        <span className="block truncate text-ds-13 text-muted-foreground" title={chosenHere ? t("sf.chosen", { category: chosenHere }) : g.values.map(catWords).join(", ")}>
                          {chosenHere ? t("sf.chosen", { category: chosenHere }) : g.values.slice(0, 3).map(catWords).join(", ")}
                        </span>
                      </span>
                    </span>
                  </ListRow>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}
