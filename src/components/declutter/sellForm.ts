/**
 * The sell flow's form: its state, its empty start, and the plain-words checks that mirror the
 * server's (formProblem, sellStepProblem), plus what the price choice saves. Pure, no React; kept
 * apart from DeclutterSellView (the flow's screens, state and server calls) so that file stays
 * under the god-component line threshold (src/test/componentSizeRatchet.test.ts).
 */
import type { DeliverySize } from "@/lib/declutter/api";
import { dollarsToCents } from "@/lib/declutter/money";
import { DECLUTTER_MIN_PHOTOS, photosWord } from "@/lib/declutter/photoRules";
import { DEFAULT_DROP_PCT, DROP_PCT_CHOICES } from "@/lib/declutter/priceDrop";
import { parseUsAddress } from "../../../supabase/functions/_shared/addressMatch";

/**
 * The ONE name of the price-drops switch, on the sell form and in Manage listing (audit DC-5: Manage said "Stop
 * price drops" with on = stopped while the form said this with on = drops). On always means it drops.
 */
export const DROPS_SWITCH_LABEL = "Lower the price over time";

/**
 * A $1 price has nothing lower to drop to (the lowest price is at least $1 and below the price), so drops don't apply
 * to that listing: it posts with no error and no drops. The seller's own switch is left as it is, so it comes back if
 * they raise the price and is what gets remembered (lead 2026-10-30).
 */
export function priceTooLowForDrops(price: string): boolean {
  const cents = dollarsToCents(price);
  return cents !== null && cents <= 100;
}

/** What the server stores for the form's price choice: off saves the lowest price as the price and step 0. */
export function priceChoiceToSave(f: Pick<FormState, "free" | "price" | "floor" | "drops" | "dropPct">): { floorCents: number; dropPct: number } | null {
  if (f.free) return { floorCents: 0, dropPct: 0 };
  const price = dollarsToCents(f.price);
  if (price === null) return null;
  if (!f.drops || priceTooLowForDrops(f.price)) return { floorCents: price, dropPct: 0 };
  const floor = dollarsToCents(f.floor);
  if (floor === null) return null;
  // A lowest price at the price can never drop, so it is saved as off: buyers then see nothing about drops (they read
  // drop_pct, never the private lowest price). Above the price stays as typed, for the server's refusal to name it.
  return { floorCents: floor, dropPct: floor === price ? 0 : f.dropPct };
}

export interface FormState {
  title: string;
  description: string;
  category: string;
  conditionStars: number;
  deliverySize: DeliverySize;
  price: string;
  floor: string;
  /**
   * "Lower the price if it doesn't sell?" is the seller's own yes/no, and the step is theirs too. A NEW
   * listing starts with it ON at 5% down to half the price, or the seller's remembered choice (owner
   * 2026-10-30, useSellerDefaultsPrefill; it was OFF until turned on, owner 2026-10-28). EMPTY keeps it
   * off for a saved draft, which loads its own. Off saves the lowest price as the price and drop_pct 0.
   */
  drops: boolean;
  dropPct: number;
  /** The Free section (20261027170717): given away, price and lowest price $0, no offers or drops. */
  free: boolean;
  areaLabel: string;
  pickupAddress: string;
}

export const EMPTY: FormState = {
  title: "",
  description: "",
  category: "other",
  conditionStars: 3,
  deliverySize: "small",
  price: "",
  floor: "",
  drops: false,
  dropPct: DEFAULT_DROP_PCT,
  free: false,
  areaLabel: "",
  pickupAddress: "",
};

/** A house number then a street word (declutter_area_label_problem's first rule; the server also checks the pickup street). */
export const AREA_ADDRESS_RE =
  /(^|[^0-9a-z-])[0-9]+[a-z]?\s+([a-z.'-]+\s+){0,3}(street|st|avenue|ave|road|rd|drive|dr|lane|ln|blvd|boulevard|parkway|pkwy|hwy|highway|cir|circle|court|ct|way|place|pl|trail|trl)\b/i;

/**
 * The area buyers see, from a typed address (owner 10-30: "It should just use the city that's typed"): the part before
 * the state and ZIP. Empty when there is none, or when that part is finer than a city: a street or a unit never shows.
 */
export function areaFromAddress(address: string): string {
  const city = parseUsAddress(address).city?.trim() ?? "";
  return /\d/.test(city) || AREA_ADDRESS_RE.test(city) ? "" : city;
}

/** An address with no city in it: said at Save, since there is no box to ask in. */
export const NO_CITY_IN_ADDRESS = "We couldn't tell the city from that address. Pick it from the list, or type it as street, city, ZIP.";

/** What is wrong with the form, in plain words, or null. Mirrors the server's checks. */
export function formProblem(f: FormState): string | null {
  if (f.title.trim().length < 3) return "Give the item a name of at least 3 characters.";
  const price = dollarsToCents(f.price);
  const floor = dollarsToCents(f.floor);
  if (!f.free && (price === null || price < 100 || price > 100_000)) return "Set a price between $1 and $1,000.";
  const dropsApply = f.drops && !priceTooLowForDrops(f.price);
  if (!f.free && dropsApply && (price === null || floor === null || floor < 100 || floor >= price)) {
    return "Set your lowest price: at least $1 and below your price. Or turn price drops off.";
  }
  if (!f.free && dropsApply && !(DROP_PCT_CHOICES as readonly number[]).includes(f.dropPct)) return "Pick how much the price drops each evening.";
  if (f.pickupAddress.trim().length < 5) return "Add the pickup address. Buyers only see it after they pay.";
  if (f.areaLabel.trim().length < 2 || AREA_ADDRESS_RE.test(f.areaLabel)) return NO_CITY_IN_ADDRESS;
  return null;
}

/** What blocks leaving a step, in the same words as formProblem (the server's checks). */
export function sellStepProblem(step: number, f: FormState, photoTotal: number): string | null {
  if (step === 1) return photoTotal < DECLUTTER_MIN_PHOTOS ? `Add at least ${photosWord(DECLUTTER_MIN_PHOTOS)}.` : null;
  if (step === 2) return f.title.trim().length < 3 ? "Give the item a name of at least 3 characters." : null;
  const all = formProblem(f);
  if (step === 3) return all && /price/i.test(all) ? all : null;
  if (step === 4) return all;
  return null;
}
