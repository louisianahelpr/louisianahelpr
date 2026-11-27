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
import { GuideSectionHead } from "@/pages/info/giftGuides/GuideSectionHead";

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

const MONTH = "(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)";
const DAY = "(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun)";
/**
 * Polish audit 11-27 #14: the card's date line, one fact on its own line. "Nov 27, 2026-Jan 1, 2027; closed Dec 7, 14,
 * 24, 31" -> "Nov 27 – Jan 1, 2027 · closed Dec 7, 14, 24, 31": no "2026" (the whole hub is the 2026 season; a range
 * into 2027 keeps its 2027), ranges as dashes that never break ("27–28"; a month change gets spaces), a month and its
 * day held together (no "Nov" / "27-Dec 20"), and the separator kept on the line before it (never a line that starts
 * with "·").
 */
export function holidayDatesDisplay(dates: string): string {
  const NB = "\u00a0";
  const WJ = "\u2060";
  return dates
    .replace(/,? 2026\b/g, "")
    .replace(/;\s*/g, `${NB}· `)
    .replace(/(\d)-(?=[A-Z])/g, `$1${NB}– `)
    .replace(/(\d)-(\d)/g, `$1${WJ}–${WJ}$2`)
    .replace(new RegExp(`\\b(${DAY}) (?=${MONTH})`, "g"), `$1${NB}`)
    .replace(new RegExp(`\\b(${MONTH}) (?=\\d)`, "g"), `$1${NB}`);
}

/** The card's place line: the area, then the address unless the address already names the town. */
function placeLine(where: string, address: string | null | undefined, city: string | null | undefined): string {
  if (!address) return where || "Open in Maps";
  if (city && address.toLowerCase().includes(city.toLowerCase())) return address;
  return [where, address].filter(Boolean).join(" · ");
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
      {/* Guide visual audit 1123b #5: the card's text was 11px (the kind) and 13px (place, date, hours, note, address) on
          a phone; the kind is 13px and the rest the guide rows' 16px now (the app's type scale has no 14px step). */}
      {tag && <p className="whitespace-nowrap text-ds-13 font-medium text-muted-foreground" data-holiday-tag="">{tag}</p>}
      {/* Polish audit 11-27 #14: one fact per line (the type above, then the dates, the hours and cost, the place). The
          dates no longer share a line with the region, so "Nov" / "27-Dec 20" never split and "2026" is gone. */}
      {!tba && (
        <p className="text-ds-15 font-semibold text-foreground" data-holiday-when="">{holidayDatesDisplay(when)}</p>
      )}
      {facts && (
        <p className="text-ds-15 text-foreground" data-holiday-facts="">
          {item.hours && <span>{item.hours}</span>}
          {item.hours && price && <span>{"\u00a0· "}</span>}
          {price && <span data-holiday-price="">{price}</span>}
        </p>
      )}
      {item.note && (
        <p className={`text-ds-15 text-muted-foreground ${more ? "" : "line-clamp-1"}`} data-holiday-note="">
          {item.note}
        </p>
      )}
      {/* Polish audit 1122 #17: the place on its own line (squeezed beside the links it was cut to "Cane ..."), then
          Website, Add to calendar and More details on the row below. */}
      <div className="mt-auto min-w-0 pt-1">
      {maps && (
        <a href={maps} target="_blank" rel="noopener noreferrer" data-holiday-maps={item.id}
          onClick={() => track("holiday_maps_click", { kind, id: item.id, region: item.region })}
          className="flex min-h-11 min-w-0 items-start gap-1.5 py-2.5 text-ds-15 text-muted-foreground link-standard" data-holiday-place="">
          {/* Polish audit 11-27 #136: the pin sits on the first line of a 2-3 line address, not centred on it. */}
          <MapPin className="mt-0.5 h-4 w-4 shrink-0 text-[hsl(var(--olivewood))]" aria-hidden />
          <span className="min-w-0" title={item.address || "Open in Maps"}>{placeLine(where, item.address, item.city)}</span>
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

/**
 * A section: its band header, then its cards (one column on a phone, two on a tablet, three on a wide desktop, owner
 * 2026-11-21). Consistency audit 1122 #3: the header is the guides' own band (GuideSectionHead: a tinted band in the
 * Hub's green with a left bar, the title, "(n)" and a chevron; owner 11-22: "Add some kind of shading or something so you
 * can tell where each section is better"), open on arrival (START_OPEN, owner 11-22: "make everything open expanded");
 * a tap closes it and opens it again. `note` is a line under the header, inside the open body. `children` is the cards,
 * or (`nested`) whole sections.
 */
export function HolidaySection({ id, title, count, note, nested = false, rows = false, data, children }: {
  id: string;
  title: string;
  count: number;
  note?: ReactNode;
  nested?: boolean;
  /** Polish audit 11-27 #15: compact two-line rows (HolidayUndatedRow) in one hairline-divided list, not cards. */
  rows?: boolean;
  data?: Record<`data-${string}`, string>;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(START_OPEN);
  return (
    <section aria-labelledby={id} className="gg-sec" data-holiday-section={id} {...data}>
      <GuideSectionHead titleId={id} bodyId={`${id}-body`} title={title} count={count} tint="green" open={open}
        onToggle={() => setOpen((o) => !o)} data={{ "data-holiday-section-toggle": id }} />
      {open && (
        <div id={`${id}-body`} className="mt-3 space-y-3">
          {note && <p className="text-ds-14 text-muted-foreground">{note}</p>}
          {nested ? <div className="space-y-section">{children}</div>
            : rows ? <ul className="divide-y divide-border md:grid md:grid-cols-2 md:gap-x-8 md:divide-y-0" data-holiday-rows="">{children}</ul>
              : <ul className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">{children}</ul>}
        </div>
      )}
    </section>
  );
}

/**
 * Polish audit 11-27 #15: an item with no 2026 date yet, as a two-line row (~72px) instead of a 270-620px card that
 * said "Dates TBA": the name, then "area · price · Website". The section's own heading says the dates are not out.
 */
export function HolidayUndatedRow({ item, kind }: { item: HolidayItem; kind: "light" | "event" }) {
  const where = holidayWhereLabel(item);
  const price = holidayPriceLabel(item.price);
  const site = openableDocumentUrl(item.url);
  const maps = mapsSearchUrl(holidayMapsQuery(item));
  const bits: [string, ReactNode][] = [];
  if (where) bits.push(["where", where]);
  if (price) bits.push(["price", <span data-holiday-price="">{price}</span>]);
  return (
    <li className="flex min-w-0 flex-col gap-0.5 py-3 font-sans md:border-b md:border-border" data-holiday-item={item.id} data-holiday-undated="">
      <h3 className="text-ds-15 font-semibold leading-snug text-foreground">{item.name}</h3>
      <p className="text-ds-14 text-muted-foreground">
        {bits.map(([k, b], i) => <span key={k}>{i > 0 && "\u00a0· "}{b}</span>)}
        {maps && (
          <>
            {bits.length > 0 && "\u00a0· "}
            <a href={maps} target="_blank" rel="noopener noreferrer" data-holiday-maps={item.id} className="link-standard"
              onClick={() => track("holiday_maps_click", { kind, id: item.id, region: item.region })}>
              Map<span className="sr-only"> for {item.name} (opens in a new tab)</span>
            </a>
          </>
        )}
        {site && (
          <>
            {"\u00a0· "}
            <a href={site} target="_blank" rel="noopener noreferrer" data-holiday-site={item.id} className="font-semibold text-[hsl(var(--olivewood))] link-standard">
              Website<span className="sr-only"> for {item.name} (opens in a new tab)</span>
            </a>
          </>
        )}
      </p>
    </li>
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
