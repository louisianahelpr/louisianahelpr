/**
 * Declutter's filters (HELPR-DESIGN-SPEC v2 §3 "Filter sheet"): Sort · Distance (with where the miles come from) ·
 * How you get it · Price · Condition · Category · Show. Every block filters a real column
 * (src/lib/declutter/browseFilters.ts). "Ships to me" and "Wanted posts" wait for shipping and the public Wanted read
 * (spec §1.8).
 *
 * They open in the ONE shared filter presentation, FilterSheet, exactly as Jobs' Browse does (owner 2026-10-28:
 * "declutter should have the same search filter and map view as jobs"): the slide-up sheet on a phone, the centred
 * panel on the desktop website. The permanent Filters column on desktop (board 39) went with it.
 */
import { useEffect, useState, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { ToggleChip } from "@/components/ui/ToggleChip";
import type { FilterSheetSection } from "@/components/dashboard/FilterSheet";
import { DISTANCE_CHOICES } from "@/lib/declutter/distance";
import { CATEGORY_GROUPS, CATEGORY_LABEL } from "@/lib/declutter/categoryIcons";
import { OTHER_WAYS, SORT_LABEL, priceRangeSwapped, type DeclutterFilters, type DeclutterSort, type OtherWay } from "@/lib/declutter/browseFilters";
import { HANDOVER_TITLE } from "./handoverCopy";
import { CONDITION_LABEL } from "./declutterUi";
import { offerAsk, type OriginAsk } from "./DeclutterBrowseBar";
import { t } from "@/lib/i18n/language";
import type { MsgKey } from "@/lib/i18n/en";
import "@/lib/i18n/enDeclutter";
import "@/lib/i18n/enDeclBrowse";

// F260q (owner 11-11): the sheet's words come from the dictionary (enDeclutter.ts / esDeclutter.ts). The caller
// (DeclutterBrowse) re-renders on a language change through useLanguage().

/** The sort choices (Closest first only once we know where you are) and the one in effect: the sheet's Sort row and
 * the phone results bar's Sort menu (DeclutterResultsBar) offer the same ones. */
export function sortChoices(located: boolean, sort: DeclutterSort): { sorts: DeclutterSort[]; sortNow: DeclutterSort } {
  const sorts: DeclutterSort[] = located ? ["closest", "newest", "price_low", "price_high"] : ["newest", "price_low", "price_high"];
  return { sorts, sortNow: !located && sort === "closest" ? "newest" : sort };
}

/** Declutter's one choice chip: the filter sheet's, and Wanted's "Within" (the same distances, the same look). */
export function Chip({ on, onClick, children }: { on: boolean; onClick: () => void; children: ReactNode }) {
  // The shared toggle chip (Q2709): 44px, aria-pressed, the firm unselected edge that shows on Wanted's card in dark.
  return (
    <ToggleChip pressed={on} onClick={onClick}>
      {children}
    </ToggleChip>
  );
}

function Row({ children }: { children: ReactNode }) {
  return <div className="flex flex-wrap gap-2">{children}</div>;
}

function originWords(o: OriginAsk): string | null {
  const { origin } = o;
  if (origin.status === "ready") {
    if (origin.source === "device") return t("decl.sheet.fromDevice");
    return t(origin.source === "profile" ? "decl.sheet.fromSaved" : origin.source === "zip" ? "decl.sheet.fromZip" : "decl.sheet.fromParish");
  }
  if (origin.status === "none" && origin.zipOnFile) return t("decl.sheet.zipNotFound");
  // AUD31-75: a guest has no profile; their location is the one way to miles.
  if (o.guest) return o.asked ? t("decl.sheet.guestNoLocation") : t("decl.sheet.guestUseLocation");
  return o.asked ? t("decl.sheet.addZip") : t("decl.sheet.useLocationOrZip");
}

/** Whole dollars typed into a price box; "" = no bound. */
function DollarBox({ label, value, onCommit }: { label: string; value: number | null; onCommit: (v: number | null) => void }) {
  const [text, setText] = useState(value === null ? "" : String(value));
  useEffect(() => setText(value === null ? "" : String(value)), [value]);
  return (
    <label className="flex h-12 min-w-0 flex-1 items-center gap-1 rounded-[14px] border border-border bg-card px-3 focus-within:border-primary focus-within:ring-2 focus-within:ring-ring">
      <span className="text-ds-15 text-muted-foreground" aria-hidden>$</span>
      <input
        aria-label={label}
        inputMode="numeric"
        placeholder={label === t("decl.sheet.lowest") ? t("decl.sheet.min") : t("decl.sheet.max")}
        value={text}
        onChange={(e) => {
          const t = e.target.value.replace(/[^0-9]/g, "").slice(0, 5);
          setText(t);
          onCommit(t === "" ? null : Number(t));
        }}
        className="w-full min-w-0 bg-transparent text-ds-15 text-foreground outline-none focus-visible:outline-none focus-visible:ring-0 placeholder:text-muted-foreground"
      />
    </label>
  );
}

/** The filter sheet's sections for Declutter Browse, in order. */
export function declutterFilterSections({
  filters,
  onChange,
  maxMiles,
  onMaxMiles,
  ask,
  showDrops,
  sellerDelivery = false,
}: {
  filters: DeclutterFilters;
  onChange: (f: DeclutterFilters) => void;
  maxMiles: number | null;
  onMaxMiles: (m: number | null) => void;
  ask: OriginAsk;
  showDrops: boolean;
  /** The declutter_seller_delivery switch: checkout offers "Seller delivers" only while it is on. */
  sellerDelivery?: boolean;
}): FilterSheetSection[] {
  const otherWays = OTHER_WAYS.filter((w) => w !== "seller_delivery" || sellerDelivery);
  const toggleWay = (w: OtherWay) =>
    onChange({ ...filters, ways: filters.ways.includes(w) ? filters.ways.filter((x) => x !== w) : [...filters.ways, w] });
  const located = ask.origin.status === "ready";
  const { sorts, sortNow } = sortChoices(located, filters.sort);
  const words = originWords(ask);
  const sections: FilterSheetSection[] = [
    {
      key: "sort",
      title: t("decl.sheet.sort"),
      content: (
        <Row>
          {sorts.map((s) => (
            <Chip key={s} on={sortNow === s} onClick={() => onChange({ ...filters, sort: s })}>
              {SORT_LABEL[s] ? t(`decl.sort.${s}` as MsgKey) : s}
            </Chip>
          ))}
        </Row>
      ),
    },
    {
      key: "distance",
      title: t("decl.sheet.distance"),
      content: (
        <div className="space-y-2.5">
          {located && (
            <Row>
              {DISTANCE_CHOICES.map((m) => (
                <Chip key={m ?? "any"} on={maxMiles === m} onClick={() => onMaxMiles(m)}>
                  {m === null ? t("decl.anyDistance") : `${m} mi`}
                </Chip>
              ))}
            </Row>
          )}
          {words && <p className="text-ds-13 text-muted-foreground">{words}</p>}
          {ask.asking && <p className="text-xs text-muted-foreground" role="status">{t("decl.sheet.finding")}</p>}
          {ask.deviceNote && <p className="text-xs text-muted-foreground" role="status">{ask.deviceNote}</p>}
          {offerAsk(ask) && (
            <Button type="button" variant="outline" size="sm" onClick={ask.askDevice}>
              {ask.asked ? t("decl.sheet.tryAgain") : t("decl.sheet.useLocation")}
            </Button>
          )}
        </div>
      ),
    },
    {
      key: "handover",
      title: t("decl.sheet.howYouGetIt"),
      content: (
        // DA-19 (audit 2026-10-30): the one square checkbox among the pills; now the same Chip as every filter.
        // A3-109: every way checkout offers, in its words; pick any and an item offering one of them shows.
        <Row>
          <Chip on={filters.porchOnly} onClick={() => onChange({ ...filters, porchOnly: !filters.porchOnly })}>{t("decl.way.porch")}</Chip>
          {otherWays.map((w) => (
            <Chip key={w} on={filters.ways.includes(w)} onClick={() => toggleWay(w)}>{HANDOVER_TITLE[w] ? t(`decl.way.${w}` as MsgKey) : w}</Chip>
          ))}
        </Row>
      ),
    },
    {
      key: "price",
      title: t("decl.sheet.price"),
      content: (
        <div className="space-y-2.5">
          {/* The Free section (20261027170717): items given away, $0. */}
          <Row>
            <Chip on={filters.freeOnly} onClick={() => onChange({ ...filters, freeOnly: !filters.freeOnly })}>{t("decl.chip.free")}</Chip>
            {/* Trades audit 11-08 #3: listings that take one of the buyer's own listings in trade. */}
            <Chip on={filters.tradesOnly} onClick={() => onChange({ ...filters, tradesOnly: !filters.tradesOnly })}>{t("decl.filter.trades")}</Chip>
          </Row>
          <div className="flex items-center gap-2">
            <DollarBox label={t("decl.sheet.lowest")} value={filters.minDollars} onCommit={(v) => onChange({ ...filters, minDollars: v })} />
            <span className="text-ds-13 text-muted-foreground">{t("decl.sheet.to")}</span>
            <DollarBox label={t("decl.sheet.highest")} value={filters.maxDollars} onCommit={(v) => onChange({ ...filters, maxDollars: v })} />
          </div>
          {/* Min above max (audit 1110 F312): say so in red; the list keeps showing the swapped range meanwhile. */}
          {priceRangeSwapped(filters) && <p className="text-ds-13 text-destructive-ink" role="alert" data-price-swapped="">{t("decl.sheet.swapped")}</p>}
        </div>
      ),
    },
    {
      key: "condition",
      title: t("decl.sheet.condition"),
      content: (
        <Row>
          {[5, 4, 3, 2, 1].map((n) => {
            const on = filters.conditions.includes(n);
            return (
              <Chip key={n} on={on} onClick={() => onChange({ ...filters, conditions: on ? filters.conditions.filter((c) => c !== n) : [...filters.conditions, n] })}>
                {CONDITION_LABEL[n] ? t(`decl.cond.${n}` as MsgKey) : n}
              </Chip>
            );
          })}
        </Row>
      ),
    },
    {
      key: "category",
      title: t("decl.item.category"),
      content: (
        // About 32 categories (owner 2026-10-30), so they sit under the same headings as the Sell picker.
        <div className="space-y-3">
          <Row>
            <Chip on={!filters.category} onClick={() => onChange({ ...filters, category: null })}>{t("decl.chip.all")}</Chip>
          </Row>
          {CATEGORY_GROUPS.map((g) => (
            <div key={g.heading} role="group" aria-label={t(`decl.group.${g.heading}` as MsgKey)} className="space-y-1.5" data-category-group={g.heading}>
              <p className="text-ds-13 text-muted-foreground" aria-hidden>{t(`decl.group.${g.heading}` as MsgKey)}</p>
              <Row>
                {g.values.map((key) => (
                  <Chip key={key} on={filters.category === key} onClick={() => onChange({ ...filters, category: filters.category === key ? null : key })}>
                    {CATEGORY_LABEL[key] ? t(`decl.cat.${key}` as MsgKey) : key}
                  </Chip>
                ))}
              </Row>
            </div>
          ))}
        </div>
      ),
    },
  ];
  if (showDrops) {
    sections.push({
      key: "show",
      title: t("decl.sheet.show"),
      content: (
        <Row><Chip on={filters.dropsOnly} onClick={() => onChange({ ...filters, dropsOnly: !filters.dropsOnly })}>{t("decl.sheet.dropsOnly")}</Chip></Row>
      ),
    });
  }
  return sections;
}
