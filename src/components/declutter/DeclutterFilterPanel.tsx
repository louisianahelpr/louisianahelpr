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
import type { FilterSheetSection } from "@/components/dashboard/FilterSheet";
import { DISTANCE_CHOICES } from "@/lib/declutter/distance";
import { CATEGORY_GROUPS, CATEGORY_LABEL } from "@/lib/declutter/categoryIcons";
import { OTHER_WAYS, SORT_LABEL, type DeclutterFilters, type DeclutterSort, type OtherWay } from "@/lib/declutter/browseFilters";
import { HANDOVER_TITLE } from "./handoverCopy";
import { CONDITION_LABEL } from "./declutterUi";
import { offerAsk, type OriginAsk } from "./DeclutterBrowseBar";

// 44px tall, the tap floor (was h-10, 40px: Declutter audit 2026-10-28).
const CHIP = "flex h-11 min-h-11 items-center rounded-full px-4 text-ds-13 font-semibold whitespace-nowrap focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

/** Declutter's one choice chip: the filter sheet's, and Wanted's "Within" (the same distances, the same look). */
export function Chip({ on, onClick, children }: { on: boolean; onClick: () => void; children: ReactNode }) {
  return (
    // The selected look inline, with its declared ink, so the gradInkContrast resolver can rebuild it.
    // Unselected: the page's own fill with a firm edge, so it shows on a card in dark mode too (lead 2026-10-28: on
    // Wanted's card, bg-card + border-border vanished in dark).
    <button type="button" aria-pressed={on} onClick={onClick} className={`${CHIP} ${on ? "btn-grad-primary !text-[hsl(var(--parchment))]" : "border border-foreground/25 bg-background text-foreground"}`}>
      {children}
    </button>
  );
}

function Row({ children }: { children: ReactNode }) {
  return <div className="flex flex-wrap gap-2">{children}</div>;
}

function originWords(o: OriginAsk): string | null {
  const { origin } = o;
  if (origin.status === "ready") {
    if (origin.source === "device") return "Miles are counted from where you are.";
    const from = origin.source === "profile" ? "your saved location" : origin.source === "zip" ? "your ZIP code's area" : "your parish's center";
    return `Miles are counted from ${from}.`;
  }
  if (origin.status === "none" && origin.zipOnFile) return "We couldn't find the area for the ZIP code on your profile, so items show without miles for now.";
  // AUD31-75: a guest has no profile; their location is the one way to miles.
  if (o.guest) return o.asked ? "Without your location, items show without miles." : "Use your location to see how far each item is.";
  return o.asked ? "Add your ZIP code in your profile to see how far each item is." : "Use your location, or add your ZIP code in your profile, to see how far each item is.";
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
        placeholder={label === "Lowest price" ? "Min" : "Max"}
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
  const sorts: DeclutterSort[] = located ? ["closest", "newest", "price_low"] : ["newest", "price_low"];
  const sortNow: DeclutterSort = !located && filters.sort === "closest" ? "newest" : filters.sort;
  const words = originWords(ask);
  const sections: FilterSheetSection[] = [
    {
      key: "sort",
      title: "Sort",
      content: (
        <Row>
          {sorts.map((s) => (
            <Chip key={s} on={sortNow === s} onClick={() => onChange({ ...filters, sort: s })}>
              {SORT_LABEL[s]}
            </Chip>
          ))}
        </Row>
      ),
    },
    {
      key: "distance",
      title: "Distance",
      content: (
        <div className="space-y-2.5">
          {located && (
            <Row>
              {DISTANCE_CHOICES.map((m) => (
                <Chip key={m ?? "any"} on={maxMiles === m} onClick={() => onMaxMiles(m)}>
                  {m === null ? "Any distance" : `${m} mi`}
                </Chip>
              ))}
            </Row>
          )}
          {words && <p className="text-ds-13 text-muted-foreground">{words}</p>}
          {ask.asking && <p className="text-xs text-muted-foreground" role="status">Finding you…</p>}
          {ask.deviceNote && <p className="text-xs text-muted-foreground" role="status">{ask.deviceNote}</p>}
          {offerAsk(ask) && (
            <Button type="button" variant="outline" size="sm" onClick={ask.askDevice}>
              {ask.asked ? "Try my location again" : "Use my location"}
            </Button>
          )}
        </div>
      ),
    },
    {
      key: "handover",
      title: "How you get it",
      content: (
        // DA-19 (audit 2026-10-30): the one square checkbox among the pills; now the same Chip as every filter.
        // A3-109: every way checkout offers, in its words; pick any and an item offering one of them shows.
        <Row>
          <Chip on={filters.porchOnly} onClick={() => onChange({ ...filters, porchOnly: !filters.porchOnly })}>{HANDOVER_TITLE.porch}</Chip>
          {otherWays.map((w) => (
            <Chip key={w} on={filters.ways.includes(w)} onClick={() => toggleWay(w)}>{HANDOVER_TITLE[w]}</Chip>
          ))}
        </Row>
      ),
    },
    {
      key: "price",
      title: "Price",
      content: (
        <div className="space-y-2.5">
          {/* The Free section (20261027170717): items given away, $0. */}
          <Row>
            <Chip on={filters.freeOnly} onClick={() => onChange({ ...filters, freeOnly: !filters.freeOnly })}>Free</Chip>
          </Row>
          <div className="flex items-center gap-2">
            <DollarBox label="Lowest price" value={filters.minDollars} onCommit={(v) => onChange({ ...filters, minDollars: v })} />
            <span className="text-ds-13 text-muted-foreground">to</span>
            <DollarBox label="Highest price" value={filters.maxDollars} onCommit={(v) => onChange({ ...filters, maxDollars: v })} />
          </div>
        </div>
      ),
    },
    {
      key: "condition",
      title: "Condition",
      content: (
        <Row>
          {[5, 4, 3, 2, 1].map((n) => {
            const on = filters.conditions.includes(n);
            return (
              <Chip key={n} on={on} onClick={() => onChange({ ...filters, conditions: on ? filters.conditions.filter((c) => c !== n) : [...filters.conditions, n] })}>
                {CONDITION_LABEL[n]}
              </Chip>
            );
          })}
        </Row>
      ),
    },
    {
      key: "category",
      title: "Category",
      content: (
        // About 32 categories (owner 2026-10-30), so they sit under the same headings as the Sell picker.
        <div className="space-y-3">
          <Row>
            <Chip on={!filters.category} onClick={() => onChange({ ...filters, category: null })}>All</Chip>
          </Row>
          {CATEGORY_GROUPS.map((g) => (
            <div key={g.heading} role="group" aria-label={g.heading} className="space-y-1.5" data-category-group={g.heading}>
              <p className="text-ds-13 text-muted-foreground" aria-hidden>{g.heading}</p>
              <Row>
                {g.values.map((key) => (
                  <Chip key={key} on={filters.category === key} onClick={() => onChange({ ...filters, category: filters.category === key ? null : key })}>
                    {CATEGORY_LABEL[key]}
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
      title: "Show",
      content: (
        <Row><Chip on={filters.dropsOnly} onClick={() => onChange({ ...filters, dropsOnly: !filters.dropsOnly })}>Only items with nightly price drops</Chip></Row>
      ),
    });
  }
  return sections;
}
