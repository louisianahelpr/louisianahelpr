/** Types for src/content/holidayHub/holidayHub.mjs and its data (lights.mjs, events.mjs). */
export type HolidayRegion = "acadiana" | "baton-rouge" | "new-orleans" | "lake-charles" | "houma-thibodaux" | "alexandria" | "shreveport" | "monroe" | "natchitoches";
export type HolidayEventCategory = "parade" | "boat-parade" | "market" | "santa" | "tree-lighting" | "bonfire" | "reveillon" | "concert" | "festival" | "fun-run";
export type HolidayLightFormat = "drive-through" | "drive-by" | "walk" | "both";
export type HolidayCost = "free" | "paid";
/** The Cost filter: free, paid, or "unlisted" (no cost listed). */
export type HolidayCostFilter = HolidayCost | "unlisted";

interface HolidayItemBase {
  id: string;
  name: string;
  region: HolidayRegion;
  city: string | null;
  address: string | null;
  lat: number | null;
  lng: number | null;
  /** The confirmed dates as words; null when TBA. */
  dates: string | null;
  /** YYYY-MM-DD; null when TBA or unknown. */
  start: string | null;
  end: string | null;
  hours: string | null;
  price: string | null;
  cost: HolidayCost | null;
  /** The organizer's own https page, or null. */
  url: string | null;
  /** No 2026 date confirmed: shown "Dates TBA". */
  tba: boolean;
  note: string | null;
}
export interface HolidayLight extends HolidayItemBase { format: HolidayLightFormat | null }
export interface HolidayEvent extends HolidayItemBase { category: HolidayEventCategory }
export type HolidayItem = HolidayLight | HolidayEvent;

export const HOLIDAY_HUB_PATH: "/holidays";
export const HOLIDAY_HIRE_PATH: "/holidays/hire-a-helpr";
export const HOLIDAY_HUB_PATHS: string[];
/** The "What" filter's choices: "lights", "events", or one kind of event. */
export type HolidayWhat = "lights" | "events" | HolidayEventCategory;
export const HOLIDAY_WHAT: { slug: HolidayWhat; label: string }[];
export const HOLIDAY_REGIONS: { slug: HolidayRegion; label: string }[];
export const HOLIDAY_EVENT_CATEGORIES: { slug: HolidayEventCategory; label: string }[];
export const HOLIDAY_EVENT_KIND: Record<HolidayEventCategory, string>;
export const HOLIDAY_LIGHT_FORMAT: Record<HolidayLightFormat, string>;
export const DATES_TBA: string;
export function regionLabel(slug: string): string;
export function holidayDateLabel(item: Pick<HolidayItemBase, "tba" | "dates">): string;
export function louisianaToday(now?: Date): string;
export function louisianaMinutes(now?: Date): number;
export function endedEarlierToday(item: Pick<HolidayItemBase, "tba" | "start" | "end" | "hours">, today: string, minutes: number): boolean;
export function weekendRange(today: string): [from: string, to: string];
/** The When filter: this weekend, today, or the next 7 days. */
export type HolidayWhen = "weekend" | "today" | "week";
export function whenRange(when: HolidayWhen | null | undefined, today: string | undefined): [from: string, to: string] | null;
/** An item as the date rules read it; `dates` (the date words) is read only for "Opens" / "season" with no end. */
type HubDated = Pick<HolidayItemBase, "tba" | "start" | "end"> & { dates?: string | null };
export declare const HOLIDAY_SEASON_END: string;
export function isOpenEnded(item: HubDated): boolean;
export function isOver(item: HubDated, today: string): boolean;
export function runsBetween(item: HubDated, from: string, to: string): boolean;
export function costMatches(itemCost: HolidayCost | null, cost: HolidayCostFilter | null | undefined): boolean;
export function holidayPriceLabel(price: string | null | undefined): string | null;
export function holidayWhereLabel(item: Pick<HolidayItemBase, "city" | "region">): string;
export function holidayMapsQuery(item: Pick<HolidayItemBase, "name" | "address" | "city">): string;
export interface LightFilters { region?: HolidayRegion | null; way?: "drive" | "walk" | null; cost?: HolidayCostFilter | null }
export function filterLights(items: readonly HolidayLight[], filters?: LightFilters, today?: string): HolidayLight[];
export interface EventFilters { region?: HolidayRegion | null; category?: HolidayEventCategory | null; cost?: HolidayCostFilter | null; weekend?: boolean; when?: HolidayWhen | null }
export function filterEvents(items: readonly HolidayEvent[], filters?: EventFilters, today?: string): HolidayEvent[];
export function isHolidayLight(item: HolidayItem): item is HolidayLight;
export function resolveHolidayWhat(what: string | null, kind?: string | null): HolidayWhat | null;
export function holidayLegacyHref(path: string, search?: string): string;
export interface HolidayFilters { what?: HolidayWhat | null; region?: HolidayRegion | null; cost?: HolidayCostFilter | null; weekend?: boolean; when?: HolidayWhen | null }
export function filterHolidayItems(lights: readonly HolidayLight[], events: readonly HolidayEvent[], filters?: HolidayFilters, today?: string): HolidayItem[];
export function holidayCountLabel(items: readonly HolidayItem[]): string;
export function holidayItemsByDay<T extends Pick<HolidayItemBase, "tba" | "start" | "end" | "name">>(items: readonly T[], today: string): { key: string; day: string | null; items: T[] }[];
export function holidayDayHeading(day: string, today?: string): string;
export const HOLIDAY_HELP: { title: string; body: string; category: string }[];
export const HOLIDAY_WORDS: {
  hubTitle: string; hubIntro: string;
  stripTitle: string; stripLine: string; stripCta: string;
  hireTitle: string; hireIntro: string;
  lightsTba: string;
  lightsTbaNote: string;
  checkFirst: string;
};
