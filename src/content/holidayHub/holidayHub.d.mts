/** Types for src/content/holidayHub/holidayHub.mjs and its data (lights.mjs, events.mjs). */
export type HolidayRegion = "acadiana" | "baton-rouge" | "new-orleans" | "lake-charles" | "houma-thibodaux" | "alexandria" | "shreveport" | "monroe" | "natchitoches";
export type HolidayEventCategory = "parade" | "boat-parade" | "market" | "santa" | "tree-lighting" | "bonfire" | "reveillon" | "concert" | "festival" | "fun-run";
export type HolidayLightFormat = "drive-through" | "drive-by" | "walk" | "both";
export type HolidayCost = "free" | "paid";

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
export const HOLIDAY_LIGHTS_PATH: "/holidays/lights";
export const HOLIDAY_EVENTS_PATH: "/holidays/events";
export const HOLIDAY_HIRE_PATH: "/holidays/hire-a-helpr";
export const HOLIDAY_HUB_PATHS: string[];
export const HOLIDAY_REGIONS: { slug: HolidayRegion; label: string }[];
export const HOLIDAY_EVENT_CATEGORIES: { slug: HolidayEventCategory; label: string }[];
export const HOLIDAY_EVENT_KIND: Record<HolidayEventCategory, string>;
export const HOLIDAY_LIGHT_FORMAT: Record<HolidayLightFormat, string>;
export const DATES_TBA: string;
export function regionLabel(slug: string): string;
export function holidayDateLabel(item: Pick<HolidayItemBase, "tba" | "dates">): string;
export function louisianaToday(now?: Date): string;
export function weekendRange(today: string): [from: string, to: string];
export function isOver(item: Pick<HolidayItemBase, "tba" | "start" | "end">, today: string): boolean;
export function runsBetween(item: Pick<HolidayItemBase, "tba" | "start" | "end">, from: string, to: string): boolean;
export function holidayMapsQuery(item: Pick<HolidayItemBase, "name" | "address" | "city">): string;
export interface LightFilters { region?: HolidayRegion | null; way?: "drive" | "walk" | null; cost?: HolidayCost | null }
export function filterLights(items: readonly HolidayLight[], filters?: LightFilters, today?: string): HolidayLight[];
export function lightsByRegion(items: readonly HolidayLight[]): { region: { slug: HolidayRegion; label: string }; items: HolidayLight[] }[];
export interface EventFilters { region?: HolidayRegion | null; category?: HolidayEventCategory | null; weekend?: boolean }
export function filterEvents(items: readonly HolidayEvent[], filters?: EventFilters, today?: string): HolidayEvent[];
export function eventsByDay(items: readonly HolidayEvent[], today: string): { key: string; day: string | null; items: HolidayEvent[] }[];
export function holidayDayHeading(day: string, today?: string): string;
export const HOLIDAY_HELP: { title: string; body: string; category: string }[];
export const HOLIDAY_WORDS: {
  hubTitle: string; hubIntro: string;
  lightsTitle: string; lightsCard: string; lightsIntro: string;
  eventsTitle: string; eventsCard: string; eventsIntro: string;
  hireTitle: string; hireCard: string; hireIntro: string;
  checkFirst: string;
};
