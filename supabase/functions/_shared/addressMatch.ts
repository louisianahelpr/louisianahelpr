// addressMatch: is what a geocoder answered really the address the member typed?
// Pure, with no imports, so the geocode-address edge function and the browser
// fallback (src/lib/addressLookup.ts) judge a match by the same rules.
//
// Only an "exact" match may become a stored pickup point: the handover checks
// refuse a person more than 200 m from it (declutter_porch_photo,
// declutter_return_dropped_off, helpr_task_picked_up), so a street or town point
// would strand a real seller, buyer or Helpr at the real address (lead, 2026-10-30).

export type MatchPrecision = "exact" | "street" | "town";

export interface AddressParts {
  houseNumber: string | null;
  /** The street as typed, house number included. */
  street: string | null;
  city: string | null;
  /** Two-letter code. */
  state: string | null;
  zip: string | null;
}

export interface FoundPlace {
  houseNumber?: string | null;
  street?: string | null;
  city?: string | null;
  /** A code or a full name. */
  state?: string | null;
  zip?: string | null;
}

const STATE_NAMES: Record<string, string> = {
  louisiana: "LA", mississippi: "MS", texas: "TX", arkansas: "AR", alabama: "AL",
};
const STATE_CODES = new Set([
  "AL", "AK", "AZ", "AR", "CA", "CO", "CT", "DE", "DC", "FL", "GA", "HI", "ID", "IL", "IN", "IA", "KS", "KY", "LA", "ME",
  "MD", "MA", "MI", "MN", "MS", "MO", "MT", "NE", "NV", "NH", "NJ", "NM", "NY", "NC", "ND", "OH", "OK", "OR", "PA", "RI",
  "SC", "SD", "TN", "TX", "UT", "VT", "VA", "WA", "WV", "WI", "WY",
]);

function stateCode(raw: string | null | undefined): string | null {
  const s = (raw ?? "").trim();
  if (!s) return null;
  const up = s.toUpperCase();
  if (STATE_CODES.has(up)) return up;
  return STATE_NAMES[s.toLowerCase()] ?? up;
}

/** Split a typed US address. Whatever cannot be told apart stays in `street` (no commas: no city). */
export function parseUsAddress(raw: string): AddressParts {
  let rest = raw.replace(/\s+/g, " ").trim().replace(/[,\s]+(usa|united states)$/i, "");
  let zip: string | null = null;
  const z = rest.match(/[,\s]+(\d{5})(?:-\d{4})?$/);
  if (z) {
    zip = z[1];
    rest = rest.slice(0, z.index);
  }
  let state: string | null = null;
  const st = rest.match(/[,\s]+(louisiana|mississippi|texas|arkansas|alabama|[a-z]{2})$/i);
  if (st && stateCode(st[1]) && (STATE_CODES.has(st[1].toUpperCase()) || st[1].length > 2)) {
    state = stateCode(st[1]);
    rest = rest.slice(0, st.index);
  }
  const segments = rest.split(",").map((s) => s.trim()).filter(Boolean);
  const street = segments[0] ?? null;
  const city = segments.length > 1 ? segments[segments.length - 1] : null;
  const house = street?.match(/^(\d+[a-z]?)(?:\s|-)/i);
  return { houseNumber: house ? house[1].toLowerCase() : null, street, city, state, zip };
}

const STREET_WORDS = new Set([
  "st", "street", "rd", "road", "ave", "avenue", "av", "dr", "drive", "ln", "lane", "ct", "court", "blvd", "boulevard", "pl",
  "place", "hwy", "highway", "pkwy", "parkway", "cir", "circle", "ter", "terrace", "trl", "trail", "way", "loop", "n", "s",
  "e", "w", "ne", "nw", "se", "sw", "north", "south", "east", "west", "us", "la", "state", "route", "rte", "parish", "old",
]);

function streetTokens(street: string): Set<string> {
  const words = street.toLowerCase().replace(/^\d+[a-z]?(?=\s|-)/, " ").split(/[^a-z0-9]+/).filter(Boolean);
  return new Set(words.filter((w) => !STREET_WORDS.has(w)));
}

function streetsAgree(typed: string, found: string): boolean {
  const a = streetTokens(typed);
  const b = streetTokens(found);
  // Nothing but generic words on one side ("Highway"): nothing to disagree on.
  if (a.size === 0 || b.size === 0) return true;
  return [...a].some((w) => b.has(w));
}

/** The answer is somewhere else: another state, or neither the typed town nor the typed ZIP. Never a match. */
export function isSomewhereElse(typed: AddressParts, found: FoundPlace): boolean {
  const foundState = stateCode(found.state);
  if (typed.state && foundState && typed.state !== foundState) return true;
  const foundCity = (found.city ?? "").trim().toLowerCase();
  const foundZip = (found.zip ?? "").trim().slice(0, 5);
  const typedCity = (typed.city ?? "").trim().toLowerCase();
  const askedForPlace = !!typedCity || !!typed.zip;
  const canCompare = (!!typedCity && !!foundCity) || (!!typed.zip && !!foundZip);
  if (!askedForPlace || !canCompare) return false;
  return !((typedCity && typedCity === foundCity) || (typed.zip && typed.zip === foundZip));
}

/** How close the answer is to what was typed, or null when it is somewhere else. */
export function matchPrecision(typed: AddressParts, found: FoundPlace): MatchPrecision | null {
  if (isSomewhereElse(typed, found)) return null;
  const foundStreet = (found.street ?? "").trim();
  if (!foundStreet || !typed.street || !streetsAgree(typed.street, foundStreet)) return "town";
  const number = (found.houseNumber ?? "").trim().toLowerCase();
  return typed.houseNumber && number === typed.houseNumber ? "exact" : "street";
}

/** Metres between two points (the same sum as the handover checks). */
export function metresBetween(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const rad = (d: number) => (d * Math.PI) / 180;
  const h = Math.sin(rad(b.lat - a.lat) / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(rad(b.lng - a.lng) / 2) ** 2;
  return 2 * 6371000 * Math.asin(Math.min(1, Math.sqrt(h)));
}
