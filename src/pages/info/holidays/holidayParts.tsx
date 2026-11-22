/**
 * The Louisiana Holiday Hub's shared parts (owner-approved 2026-11-20): the column, the page-view event, and one card
 * per light display or event with its "Open in Maps" link (the filters live on HolidayHub, in the shared FilterSheet). Words and rules live in
 * src/content/holidayHub/holidayHub.mjs. Guard: src/test/holidayHub.test.tsx.
 */
import { useEffect, useState, type ReactNode } from "react";
import { InlineTextButton } from "@/components/ui/InlineTextButton";
import { CalendarPlus, MapPin } from "lucide-react";
import { Button } from "@/components/ui/button";
import { track } from "@/lib/analytics";
import { mapsSearchUrl } from "@/lib/mapsLink";
import { openableDocumentUrl } from "@/lib/storagePath";
import { DATES_TBA, holidayDateLabel, holidayMapsQuery, holidayPriceLabel, holidayWhereLabel, type HolidayItem } from "@/content/holidayHub/holidayHub.mjs";
import { START_OPEN } from "@/pages/info/giftGuides/startOpen";

/** The hub's column (the lists sit two across from md up), and its header's: the column plus the shell's side padding. */
export const HUB_COLUMN = "mx-auto max-w-[1040px]";
export const HUB_HEADER_COLUMN = "mx-auto max-w-[calc(1040px+2.5rem)] sm:max-w-[calc(1040px+4rem)] lg:max-w-[calc(1040px+6rem)]";

/** One page_view per hub page opened (no personal data: the page's name only). */
export function useHolidayPageView(page: "holidays" | "holidays_hire") {
  useEffect(() => {
    track("page_view", { page });
  }, [page]);
}

/** The item's calendar entry, saved or shared (the file helper and the .ics builder load on tap only). */
async function addToCalendar(item: HolidayItem) {
  const [{ holidayIcs, holidayIcsName }, { saveOrShareFile }] = await Promise.all([import("@/lib/holidayIcs"), import("@/lib/fileExport")]);
  const text = holidayIcs(item, new Date());
  if (!text) return;
  track("holiday_ics_click", { id: item.id, region: item.region });
  await saveOrShareFile({ blob: new Blob([text], { type: "text/calendar" }), filename: holidayIcsName(item), label: item.name, source: "holidayHub.ics" });
}

/**
 * One light display or event, compact (owner 2026-11-21: "needs polishing, they are too big"; then "remove the circles
 * around open in maps and website"): the name with its kind as a small muted tag, one muted line "Lake Charles · Nov
 * 20 – 22", one line for the hours and cost when listed, the address as a single line that IS the Maps link (a map
 * pin, no button), a small Website text link, and the note as one line that opens on "More details". No round
 * buttons. The links sit at the card's foot so a row's cards line up.
 */
export function HolidayCard({ item, kind, tag }: { item: HolidayItem; kind: "light" | "event"; tag?: string | null }) {
  const when = holidayDateLabel(item);
  const tba = when === DATES_TBA;
  // Holiday audit 1121 area 5 #15 / #7: no "Lake Charles · Lake Charles & SWLA", and never a bare "$" for the price.
  const where = holidayWhereLabel(item);
  const price = holidayPriceLabel(item.price);
  const maps = mapsSearchUrl(holidayMapsQuery(item));
  const site = openableDocumentUrl(item.url);
  // Owner 2026-11-22 ("make everything open expanded"): a card's whole note shows on arrival (START_OPEN).
  const [more, setMore] = useState(START_OPEN);
  const facts = [item.hours, price].filter(Boolean).join(" · ");
  return (
    <li className="flex min-w-0 flex-col gap-1 rounded-[16px] border border-border bg-card px-4 py-3 font-sans" data-holiday-item={item.id}>
      {/* Polish audit 1122 #17: the kind is its own small line under the name, on one line (inside the title it broke
          mid-word, "Walk- / through", and a screen reader heard "Lafayette Holiday Market Market"). */}
      <h3 className="text-ds-16 font-semibold leading-snug text-foreground">{item.name}</h3>
      {tag && <p className="whitespace-nowrap text-ds-12 font-medium text-muted-foreground" data-holiday-tag="">{tag}</p>}
      <p className="text-ds-14 text-muted-foreground">
        {where && <span>{where} · </span>}
        <span data-holiday-when="" className={tba ? "text-muted-foreground" : "font-semibold text-foreground"}>{when}</span>
      </p>
      {facts && (
        <p className="text-ds-14 text-foreground">
          {item.hours && <span>{item.hours}</span>}
          {item.hours && price && <span> · </span>}
          {price && <span data-holiday-price="">{price}</span>}
        </p>
      )}
      {item.note && (
        <p className={`text-ds-13 text-muted-foreground ${more ? "" : "line-clamp-1"}`} data-holiday-note="">
          {item.note}
        </p>
      )}
      {/* Polish audit 1122 #17: the place on its own line (squeezed beside the links it was cut to "Cane ..."), then
          Website, Add to calendar and More details on the row below. */}
      <div className="mt-auto min-w-0 pt-1">
      {maps && (
        <a href={maps} target="_blank" rel="noopener noreferrer" data-holiday-maps={item.id}
          onClick={() => track("holiday_maps_click", { kind, id: item.id, region: item.region })}
          className="flex min-h-11 min-w-0 items-center gap-1.5 text-ds-13 text-muted-foreground link-standard">
          <MapPin className="h-4 w-4 shrink-0 text-[hsl(var(--olivewood))]" aria-hidden />
          <span className="min-w-0" title={item.address || "Open in Maps"}>{item.address || "Open in Maps"}</span>
          <span className="sr-only"> (open in Maps, a new tab)</span>
        </a>
      )}
      <div className="flex min-w-0 flex-wrap items-center gap-x-4" data-holiday-actions="">
        {site && (
          <a href={site} target="_blank" rel="noopener noreferrer" data-holiday-site={item.id}
            className="inline-flex min-h-11 shrink-0 items-center text-ds-13 font-semibold text-[hsl(var(--olivewood))] link-standard">
            Website<span className="sr-only"> for {item.name} (opens in a new tab)</span>
          </a>
        )}
        {/* Holiday audit 1121 area 5 #20: a dated item goes into the visitor's calendar (an all-day .ics entry). */}
        {item.start && !item.tba && (
          <Button type="button" variant="ghost" size="iconCompact" onClick={() => void addToCalendar(item)} aria-label={`Add ${item.name} to your calendar`} data-holiday-ics={item.id}
            className="shrink-0 text-[hsl(var(--olivewood))] hover:text-[hsl(var(--bark))] [&_svg]:size-4">
            <CalendarPlus aria-hidden />
          </Button>
        )}
        {item.note && item.note.length > 60 && !more && (
          <InlineTextButton onClick={() => setMore(true)} data-holiday-more={item.id}
            className="inline-flex min-h-11 shrink-0 items-center text-ds-13 font-semibold text-[hsl(var(--olivewood))]">
            More details
          </InlineTextButton>
        )}
      </div>
      </div>
    </li>
  );
}

/** A heading and its cards: one column on a phone, two on a tablet, three on a wide desktop (owner 2026-11-21). */
export function HolidaySection({ id, title, count, children }: { id: string; title: string; count: number; children: ReactNode }) {
  return (
    <section aria-labelledby={id} className="space-y-3">
      <h2 id={id} className="text-ds-20 font-semibold text-foreground">
        {title}<span className="ml-1.5 text-ds-15 font-normal text-muted-foreground">({count})</span>
      </h2>
      <ul className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">{children}</ul>
    </section>
  );
}

/** Shown when the filters leave nothing. */
export function HolidayNothing({ onClear, children, clearLabel = "Clear filters" }: { onClear: () => void; children: ReactNode; clearLabel?: string }) {
  return (
    <div className="rounded-[20px] border border-border bg-card p-6 text-center font-sans" data-holiday-empty="">
      <p className="text-ds-15 text-foreground">{children}</p>
      <Button variant="outline" size="sm" className="mt-3 rounded-full" onClick={onClear}>{clearLabel}</Button>
    </div>
  );
}
