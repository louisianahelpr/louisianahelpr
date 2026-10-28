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

/** What the server stores for the form's price choice: off saves the lowest price as the price and step 0. */
export function priceChoiceToSave(f: Pick<FormState, "free" | "price" | "floor" | "drops" | "dropPct">): { floorCents: number; dropPct: number } | null {
  if (f.free) return { floorCents: 0, dropPct: 0 };
  const price = dollarsToCents(f.price);
  if (price === null) return null;
  if (!f.drops) return { floorCents: price, dropPct: 0 };
  const floor = dollarsToCents(f.floor);
  return floor === null ? null : { floorCents: floor, dropPct: f.dropPct };
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
   * Owner 2026-10-28: "Lower the price if it doesn't sell?" is the seller's own yes/no, OFF until
   * they turn it on (a lowest price never turns drops on by itself), and the step is theirs too.
   * Off saves the lowest price as the price and drop_pct 0.
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

/** What is wrong with the form, in plain words, or null. Mirrors the server's checks. */
export function formProblem(f: FormState): string | null {
  if (f.title.trim().length < 3) return "Give the item a name of at least 3 characters.";
  const price = dollarsToCents(f.price);
  const floor = dollarsToCents(f.floor);
  if (!f.free && (price === null || price < 100 || price > 100_000)) return "Set a price between $1 and $1,000.";
  if (!f.free && f.drops && (price === null || floor === null || floor < 100 || floor >= price)) {
    return "Set your lowest price: at least $1 and below your price. Or turn price drops off.";
  }
  if (!f.free && f.drops && !(DROP_PCT_CHOICES as readonly number[]).includes(f.dropPct)) return "Pick how much the price drops each evening.";
  if (f.areaLabel.trim().length < 2) return "Add your neighborhood or town.";
  if (AREA_ADDRESS_RE.test(f.areaLabel)) return "Use your neighborhood or town for the area, not a street address.";
  if (f.pickupAddress.trim().length < 5) return "Add the pickup address. Buyers only see it after they pay.";
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
