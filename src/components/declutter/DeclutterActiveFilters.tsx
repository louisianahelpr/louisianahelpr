/**
 * F055 (UI audit 11-09): after Filters > Show items only a tiny number on the filter icon said the list was filtered,
 * so it was easy to forget. Each filter that is on shows as a removable chip above the cards ("Under $20 ×",
 * "Porch pickup ×"); tapping one turns that filter off. Category and Free are not repeated here: they already show as
 * pressed chips in the category row above (owner pick 4, 11-08). Sort is an order, not a filter.
 */
import { RemoveFilterChip } from "@/components/ui/RemoveFilterChip";
import type { DeclutterFilters } from "@/lib/declutter/browseFilters";
import { CONDITION_LABEL } from "@/lib/declutter/conditionLabels";
import { HANDOVER_TITLE } from "./handoverCopy";
import { t, useLanguage } from "@/lib/i18n/language";
import type { MsgKey } from "@/lib/i18n/en";
import "@/lib/i18n/enDeclutter";
import "@/lib/i18n/enDeclBrowse";

export interface ActiveFilterPill {
  key: string;
  label: string;
  /** The filters with this one turned off (and the distance, for the distance pill). */
  clear: (f: DeclutterFilters, maxMiles: number | null) => { filters: DeclutterFilters; maxMiles: number | null };
}

function priceLabel(min: number | null, max: number | null): string {
  if (min !== null && max !== null) return t("decl.price.range", { min, max });
  if (min !== null) return t("decl.price.andUp", { min });
  return t("decl.price.under", { max: String(max) });
}

/** The chips for what is on, in the sheet's order. Pure, so the rule is tested on its own. */
export function activeFilterPills(f: DeclutterFilters, maxMiles: number | null): ActiveFilterPill[] {
  const out: ActiveFilterPill[] = [];
  if (maxMiles !== null) out.push({ key: "distance", label: t("decl.within", { miles: maxMiles }), clear: (x) => ({ filters: x, maxMiles: null }) });
  if (f.minDollars !== null || f.maxDollars !== null) {
    out.push({ key: "price", label: priceLabel(f.minDollars, f.maxDollars), clear: (x, m) => ({ filters: { ...x, minDollars: null, maxDollars: null }, maxMiles: m }) });
  }
  if (f.conditions.length > 0) {
    const words = [...f.conditions].sort((a, b) => b - a).map((c) => (CONDITION_LABEL[c] ? t(`decl.cond.${c}` as MsgKey) : String(c))).join(", ");
    out.push({ key: "condition", label: words, clear: (x, m) => ({ filters: { ...x, conditions: [] }, maxMiles: m }) });
  }
  if (f.porchOnly) out.push({ key: "porch", label: t("decl.way.porch"), clear: (x, m) => ({ filters: { ...x, porchOnly: false }, maxMiles: m }) });
  for (const w of f.ways) {
    out.push({ key: `way-${w}`, label: HANDOVER_TITLE[w] ? t(`decl.way.${w}` as MsgKey) : w, clear: (x, m) => ({ filters: { ...x, ways: x.ways.filter((y) => y !== w) }, maxMiles: m }) });
  }
  if (f.dropsOnly) out.push({ key: "drops", label: t("decl.filter.drops"), clear: (x, m) => ({ filters: { ...x, dropsOnly: false }, maxMiles: m }) });
  if (f.tradesOnly) out.push({ key: "trades", label: t("decl.filter.trades"), clear: (x, m) => ({ filters: { ...x, tradesOnly: false }, maxMiles: m }) });
  return out;
}

export function DeclutterActiveFilters({ filters, maxMiles, onChange }: {
  filters: DeclutterFilters;
  maxMiles: number | null;
  onChange: (next: { filters: DeclutterFilters; maxMiles: number | null }) => void;
}) {
  useLanguage(); // F260q: re-draw the chips when the language changes
  const pills = activeFilterPills(filters, maxMiles);
  if (pills.length === 0) return null;
  return (
    <ul aria-label={t("decl.filtersOn")} data-active-filters="" className="flex flex-wrap gap-2">
      {pills.map((p) => (
        <li key={p.key}>
          <RemoveFilterChip
            data-active-filter={p.key}
            aria-label={t("decl.removeFilter", { label: p.label })}
            onClick={() => onChange(p.clear(filters, maxMiles))}
          >
            {p.label}
          </RemoveFilterChip>
        </li>
      ))}
    </ul>
  );
}
