/**
 * Declutter's ONE filter panel (board 39's column, the same blocks in the
 * phone's slide-up sheet: HELPR-DESIGN-SPEC v2 §3 "Filter sheet"): Sort ·
 * Distance (with where the miles come from) · How you get it · Price ·
 * Condition · Category · Show. Every block filters a real column
 * (src/lib/declutter/browseFilters.ts). "Ships to me" and "Wanted posts" wait
 * for shipping and the public Wanted read (spec §1.8).
 */
import { useEffect, useState, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { DISTANCE_CHOICES } from "@/lib/declutter/distance";
import { CATEGORY_WORD } from "@/lib/declutter/categoryIcons";
import { SORT_LABEL, type DeclutterFilters, type DeclutterSort } from "@/lib/declutter/browseFilters";
import { CONDITION_LABEL } from "./declutterUi";
import type { OriginAsk } from "./DeclutterBrowseBar";

const CHIP = "flex h-10 items-center rounded-full px-4 text-ds-13 font-semibold whitespace-nowrap focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

function Block({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="space-y-2.5" aria-label={title}>
      <h3 className="text-ds-12 font-semibold uppercase tracking-[0.08em] text-muted-foreground">{title}</h3>
      {children}
    </section>
  );
}

function Chip({ on, onClick, children }: { on: boolean; onClick: () => void; children: ReactNode }) {
  return (
    // The selected look inline, with its declared ink, so the gradInkContrast resolver can rebuild it.
    <button type="button" aria-pressed={on} onClick={onClick} className={`${CHIP} ${on ? "btn-grad-primary !text-[hsl(var(--parchment))]" : "border border-border bg-card text-foreground"}`}>
      {children}
    </button>
  );
}

function originWords(o: OriginAsk): string | null {
  const { origin } = o;
  if (origin.status === "ready") {
    if (origin.source === "device") return "Miles are counted from where you are.";
    const from = origin.source === "profile" ? "your saved location" : origin.source === "zip" ? "your ZIP code's area" : "your parish's center";
    return `Miles are counted from ${from}.`;
  }
  if (origin.status === "none" && origin.zipOnFile) return "We couldn't find the area for the ZIP code on your profile, so items show without miles for now.";
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
        className="w-full min-w-0 bg-transparent text-ds-15 text-foreground outline-none focus-visible:outline-none focus-visible:ring-0 placeholder:text-muted-foreground/70"
      />
    </label>
  );
}

export function DeclutterFilterPanel({
  filters,
  onChange,
  maxMiles,
  onMaxMiles,
  ask,
  showDrops,
}: {
  filters: DeclutterFilters;
  onChange: (f: DeclutterFilters) => void;
  maxMiles: number | null;
  onMaxMiles: (m: number | null) => void;
  ask: OriginAsk;
  showDrops: boolean;
}) {
  const located = ask.origin.status === "ready";
  const sorts: DeclutterSort[] = located ? ["closest", "newest", "price_low"] : ["newest", "price_low"];
  const sortNow: DeclutterSort = !located && filters.sort === "closest" ? "newest" : filters.sort;
  const words = originWords(ask);
  return (
    <div data-filter-panel="" className="space-y-6">
      <Block title="Sort">
        <div className="flex flex-wrap gap-2">
          {sorts.map((s) => (
            <Chip key={s} on={sortNow === s} onClick={() => onChange({ ...filters, sort: s })}>
              {SORT_LABEL[s]}
            </Chip>
          ))}
        </div>
      </Block>
      <Block title="Distance">
        {located && (
          <div className="flex flex-wrap gap-2">
            {DISTANCE_CHOICES.map((m) => (
              <Chip key={m ?? "any"} on={maxMiles === m} onClick={() => onMaxMiles(m)}>
                {m === null ? "Any distance" : `${m} mi`}
              </Chip>
            ))}
          </div>
        )}
        {words && <p className="text-ds-13 text-muted-foreground">{words}</p>}
        {ask.asking && <p className="text-xs text-muted-foreground" role="status">Finding you…</p>}
        {ask.deviceNote && <p className="text-xs text-muted-foreground" role="status">{ask.deviceNote}</p>}
        {!(located && ask.origin.status === "ready" && ask.origin.source === "device") && (!ask.asked || ask.canAskAgain) && (
          <Button type="button" variant="outline" size="sm" onClick={ask.askDevice}>
            {ask.asked ? "Try my location again" : "Use my location"}
          </Button>
        )}
      </Block>
      <Block title="How you get it">
        <label className="flex min-h-11 items-center gap-3 text-ds-15 text-foreground">
          <Checkbox checked={filters.porchOnly} onCheckedChange={(v) => onChange({ ...filters, porchOnly: v === true })} />
          Porch pickup only
        </label>
      </Block>
      <Block title="Price">
        <div className="flex items-center gap-2">
          <DollarBox label="Lowest price" value={filters.minDollars} onCommit={(v) => onChange({ ...filters, minDollars: v })} />
          <span className="text-ds-13 text-muted-foreground">to</span>
          <DollarBox label="Highest price" value={filters.maxDollars} onCommit={(v) => onChange({ ...filters, maxDollars: v })} />
        </div>
      </Block>
      <Block title="Condition">
        <div className="flex flex-wrap gap-2">
          {[5, 4, 3, 2, 1].map((n) => {
            const on = filters.conditions.includes(n);
            return (
              <Chip key={n} on={on} onClick={() => onChange({ ...filters, conditions: on ? filters.conditions.filter((c) => c !== n) : [...filters.conditions, n] })}>
                {CONDITION_LABEL[n]}
              </Chip>
            );
          })}
        </div>
      </Block>
      <Block title="Category">
        <div className="flex flex-wrap gap-2">
          <Chip on={!filters.category} onClick={() => onChange({ ...filters, category: null })}>All</Chip>
          {Object.keys(CATEGORY_WORD).map((key) => (
            <Chip key={key} on={filters.category === key} onClick={() => onChange({ ...filters, category: filters.category === key ? null : key })}>
              {CATEGORY_WORD[key]}
            </Chip>
          ))}
        </div>
      </Block>
      {showDrops && (
        <Block title="Show">
          <label className="flex min-h-11 items-center gap-3 text-ds-15 text-foreground">
            <Checkbox checked={filters.dropsOnly} onCheckedChange={(v) => onChange({ ...filters, dropsOnly: v === true })} />
            Only items with nightly price drops
          </label>
        </Block>
      )}
    </div>
  );
}
