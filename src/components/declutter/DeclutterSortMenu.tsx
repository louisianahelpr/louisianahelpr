/**
 * The phone results bar's Sort menu (DeclutterResultsBar, owner 11-14 Depop/Vinted audit item 7), in its own chunk.
 * Radix's dropdown menu (~14 KB gz with its popper) is not on Declutter's first screen: the bar appears only once a
 * search is typed, and it fetches this file when it mounts (Q178 critical-path budget, /declutter).
 * Guard: src/test/declutterDepopPhoneLayout.test.tsx.
 */
import { ArrowUpDown, Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import type { DeclutterSort } from "@/lib/declutter/browseFilters";
import { useLanguage } from "@/lib/i18n/language";
import type { MsgKey } from "@/lib/i18n/en";
import "@/lib/i18n/enDeclutter";
import "@/lib/i18n/enDeclBrowse";

export default function DeclutterSortMenu({ sorts, sort, onSort, defaultOpen }: {
  sorts: DeclutterSort[];
  sort: DeclutterSort;
  onSort: (s: DeclutterSort) => void;
  /** Tapped before this chunk arrived: open as soon as it is drawn. */
  defaultOpen: boolean;
}) {
  const { t } = useLanguage();
  return (
    <DropdownMenu defaultOpen={defaultOpen}>
      <DropdownMenuTrigger asChild>
        <Button type="button" variant="ghost" size="sm" className="flex-1 gap-2 font-semibold" data-results-sort="" data-sort-ready="">
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
  );
}
