/**
 * Declutter search results on a phone (owner 11-14, Depop/Vinted audit item 7): while a search is typed, the query
 * sits above the grid as a heading ("“lamp”", how many found), with ONE compact Filter | Sort bar right above the
 * cards, as Depop's results page has. Filter opens the same filter sheet as the search bar's Filters button; Sort offers the same
 * choices as the sheet's Sort row (sortChoices). Nothing new is filtered. Desktop keeps its own header row.
 * Guard: src/test/declutterDepopPhoneLayout.test.tsx.
 */
import type { Ref } from "react";
import { ArrowUpDown, Check, SlidersHorizontal } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { TYPE } from "@/components/ui/designScale";
import type { DeclutterSort } from "@/lib/declutter/browseFilters";
import { useLanguage } from "@/lib/i18n/language";
import type { MsgKey } from "@/lib/i18n/en";
import "@/lib/i18n/enDeclutter";
import "@/lib/i18n/enDeclBrowse";

/** The query as the results' heading, and how many items it found. */
export function DeclutterResultsHead({ query, count }: { query: string; count: number | null }) {
  const { t } = useLanguage();
  return (
    <div className="min-w-0" data-results-head="">
      <h2 className={`${TYPE.lg} truncate font-bold`} data-results-query="">{`“${query.trim()}”`}</h2>
      {count !== null && (
        <p className={`${TYPE.sm} text-muted-foreground`} data-results-count="">
          {count === 1 ? t("decl.results.one") : t("decl.results.many", { n: count })}
        </p>
      )}
    </div>
  );
}

/** The compact Filter | Sort bar right above the results grid. */
export function DeclutterResultsBar({ filterCount, onFilters, sorts, sort, onSort, filtersRef }: {
  filterCount: number;
  onFilters: () => void;
  /** The sort choices the filter sheet offers right now (sortChoices). */
  sorts: DeclutterSort[];
  sort: DeclutterSort;
  onSort: (s: DeclutterSort) => void;
  filtersRef?: Ref<HTMLButtonElement>;
}) {
  const { t } = useLanguage();
  return (
    <div className="flex h-11 items-stretch divide-x divide-border border-y border-border" data-results-bar="">
      <Button ref={filtersRef} type="button" variant="ghost" className="h-11 flex-1 gap-2 rounded-none font-semibold" onClick={onFilters}
        aria-label={filterCount > 0 ? `${t("decl.filters")} (${filterCount})` : t("decl.filters")} data-results-filter="">
        <SlidersHorizontal className="h-4 w-4" aria-hidden />
        {t("decl.filters")}
        {filterCount > 0 && <span aria-hidden className="rounded-full bg-primary px-1.5 text-ds-11 font-bold text-primary-foreground">{filterCount}</span>}
      </Button>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button type="button" variant="ghost" className="h-11 flex-1 gap-2 rounded-none font-semibold" data-results-sort="">
            <ArrowUpDown className="h-4 w-4" aria-hidden />
            {t("decl.sheet.sort")}
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="min-w-[12rem]">
          {sorts.map((s) => (
            <DropdownMenuItem key={s} className="min-h-11 gap-2" data-sort-choice={s} aria-checked={s === sort} role="menuitemradio" onSelect={() => onSort(s)}>
              <Check className={`h-4 w-4 ${s === sort ? "" : "invisible"}`} aria-hidden />
              {t(`decl.sort.${s}` as MsgKey)}
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
