/**
 * The Louisiana Holiday Hub's shared parts (owner-approved 2026-11-20): the column, the page-view event, a filter row
 * of shared FilterChips, and one card per light display or event with its "Open in Maps" link. Words and rules live in
 * src/content/holidayHub/holidayHub.mjs. Guard: src/test/holidayHub.test.tsx.
 */
import { useEffect, useRef, type ReactNode } from "react";
import { FilterChip } from "@/components/ui/FilterChip";
import { Button } from "@/components/ui/button";
import { track } from "@/lib/analytics";
import { mapsSearchUrl } from "@/lib/mapsLink";
import { openableDocumentUrl } from "@/lib/storagePath";
import { DATES_TBA, holidayDateLabel, holidayMapsQuery, regionLabel, type HolidayItem } from "@/content/holidayHub/holidayHub.mjs";

/** The hub's column (the lists sit two across from md up), and its header's: the column plus the shell's side padding. */
export const HUB_COLUMN = "mx-auto max-w-[1040px]";
export const HUB_HEADER_COLUMN = "mx-auto max-w-[calc(1040px+2.5rem)] sm:max-w-[calc(1040px+4rem)] lg:max-w-[calc(1040px+6rem)]";

/** One page_view per hub page opened (no personal data: the page's name only). */
export function useHolidayPageView(page: "holidays" | "holidays_hire") {
  useEffect(() => {
    track("page_view", { page });
  }, [page]);
}

/**
 * A labelled row of shared filter chips, one pressed. Scrolls sideways on a phone, wraps from sm up. On a phone the row
 * opens scrolled to its pressed chip, so a preset from the URL (?what=reveillon) is never hidden off the edge.
 */
export function HolidayFilterRow<T extends string>({ label, options, value, onChange, attr }: {
  label: string;
  options: readonly { value: T; label: string }[];
  value: T;
  onChange: (v: T) => void;
  attr: `data-${string}`;
}) {
  const rowRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const row = rowRef.current;
    const chip = row?.querySelector<HTMLElement>('[aria-pressed="true"]');
    if (!row || !chip || row.scrollWidth <= row.clientWidth) return;
    const right = chip.offsetLeft + chip.offsetWidth;
    if (chip.offsetLeft < row.scrollLeft || right > row.scrollLeft + row.clientWidth) row.scrollLeft = Math.max(0, chip.offsetLeft - 20);
    // Mount only: a chip the person taps is already in view.
  }, []);
  return (
    <div className="min-w-0">
      <p className="mb-1.5 text-ds-13 font-semibold text-muted-foreground" aria-hidden="true">{label}</p>
      <div ref={rowRef} role="group" aria-label={label} className="-mx-5 flex gap-2 overflow-x-auto px-5 pb-1 sm:mx-0 sm:flex-wrap sm:overflow-visible sm:px-0">
        {options.map((o) => (
          <FilterChip key={o.value} pressed={value === o.value} onClick={() => onChange(o.value)} className="shrink-0" {...{ [attr]: o.value }}>
            {o.label}
          </FilterChip>
        ))}
      </div>
    </div>
  );
}

/** "Open in Maps": a plain maps search on the place's name and address (no API key), with its outbound-click event. */
function OpenInMaps({ item, kind }: { item: HolidayItem; kind: "light" | "event" }) {
  const href = mapsSearchUrl(holidayMapsQuery(item));
  if (!href) return null;
  return (
    <Button asChild variant="outline" size="sm" className="rounded-full">
      <a href={href} target="_blank" rel="noopener noreferrer" data-holiday-maps={item.id}
        onClick={() => track("holiday_maps_click", { kind, id: item.id, region: item.region })}>
        Open in Maps<span className="sr-only"> for {item.name} (opens in a new tab)</span>
      </a>
    </Button>
  );
}

/** One light display or event: name, where, when (or "Dates TBA"), hours, price, a line about it, and its links. */
export function HolidayCard({ item, kind, tag }: { item: HolidayItem; kind: "light" | "event"; tag?: string | null }) {
  const when = holidayDateLabel(item);
  const tba = when === DATES_TBA;
  const where = [item.city, regionLabel(item.region)].filter(Boolean).join(" · ");
  return (
    <li className="flex min-w-0 flex-col rounded-[20px] border border-border bg-card p-5 font-sans" data-holiday-item={item.id}>
      {tag && <p className="text-ds-12 font-semibold uppercase tracking-[0.08em] text-muted-foreground">{tag}</p>}
      <h3 className="mt-0.5 text-ds-17 font-semibold leading-snug text-foreground">{item.name}</h3>
      {where && <p className="text-ds-14 text-muted-foreground">{where}</p>}
      <dl className="mt-3 space-y-1 text-ds-15 text-foreground">
        <div className="flex gap-2">
          <dt className="sr-only">When</dt>
          <dd data-holiday-when="" className={tba ? "font-semibold text-muted-foreground" : "font-semibold"}>{when}</dd>
        </div>
        {item.hours && <div className="flex gap-2"><dt className="sr-only">Hours</dt><dd>{item.hours}</dd></div>}
        {item.price && <div className="flex gap-2"><dt className="sr-only">Cost</dt><dd>{item.price}</dd></div>}
        {item.address && <div className="flex gap-2"><dt className="sr-only">Address</dt><dd className="text-muted-foreground">{item.address}</dd></div>}
      </dl>
      {item.note && <p className="mt-2 text-ds-14 text-muted-foreground">{item.note}</p>}
      <div className="mt-auto flex flex-wrap gap-2 pt-4">
        <OpenInMaps item={item} kind={kind} />
        {openableDocumentUrl(item.url) && (
          <Button asChild variant="outline" size="sm" className="rounded-full">
            <a href={openableDocumentUrl(item.url) ?? undefined} target="_blank" rel="noopener noreferrer" data-holiday-site={item.id}>
              Website<span className="sr-only"> for {item.name} (opens in a new tab)</span>
            </a>
          </Button>
        )}
      </div>
    </li>
  );
}

/** A heading and its cards, two across from md up. */
export function HolidaySection({ id, title, count, children }: { id: string; title: string; count: number; children: ReactNode }) {
  return (
    <section aria-labelledby={id} className="space-y-3">
      <h2 id={id} className="text-ds-20 font-semibold text-foreground">
        {title}<span className="ml-1.5 text-ds-15 font-normal text-muted-foreground">({count})</span>
      </h2>
      <ul className="grid gap-3 md:grid-cols-2">{children}</ul>
    </section>
  );
}

/** Shown when the filters leave nothing. */
export function HolidayNothing({ onClear, children }: { onClear: () => void; children: ReactNode }) {
  return (
    <div className="rounded-[20px] border border-border bg-card p-6 text-center font-sans" data-holiday-empty="">
      <p className="text-ds-15 text-foreground">{children}</p>
      <Button variant="outline" size="sm" className="mt-3 rounded-full" onClick={onClear}>Clear filters</Button>
    </div>
  );
}
