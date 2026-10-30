/**
 * EasyPost rates for Declutter shipping (docs/specs/shipping-draft.md S2 rates, sections 3, 4.2, 5.2; Q2259).
 * Pure: no network, no Deno APIs, so vitest runs it on recorded responses. ship-rates (S2) calls EasyPost and
 * hands the response here; the label worker (S5) re-checks the chosen rate with shipping_rate_buyable.
 *
 * Rules:
 *  - Only the services the owner allowed (decision 13, 2026-10-29): USPS Ground Advantage (cubic pricing included
 *    when EasyPost returns it for the box), USPS Priority (the one faster option) and UPS Ground. Matched by carrier
 *    AND service; anything else is dropped, never shown. Air, express and overnight are refused by name as well, so
 *    a later edit to the allowed map can never let one through.
 *  - The buyer sees AT MOST 3 options: the cheapest rate of each allowed service, cheapest first, the first one
 *    pre-selected. Filtered here, on the server, never in the client.
 *  - EasyPost's dollar strings become integer cents exactly ("7.33" -> 733), never through a float multiply.
 *    A malformed amount drops that rate (never a guess).
 *  - Rate shown = rate charged = rate bought: the quote carries the provider's rate id and shipment id, and the
 *    amount the buyer pays is exactly the rate (EasyPost's label fee is $0 under 3,000 labels a month, spec 2).
 *  - The key follows the order's Stripe mode, never the other one (money review fix 8).
 *  - No member email or phone ever goes to EasyPost (lead design rule 2026-10-30, spec 4.2): the request is built
 *    from address and parcel fields only, so EasyPost's own customer emails and texts can never fire.
 */

type ShipService = "usps_ground_advantage" | "usps_priority" | "ups_ground";

/**
 * "<carrier>:<EasyPost service>" -> ours. The cubic names and the UPS "Ground" string follow EasyPost's naming but are
 * confirmed by the first live test quote through ship-rates (spec 4.2); a wrong name only drops that rate.
 */
const SERVICE_MAP: Record<string, ShipService> = {
  "USPS:GroundAdvantage": "usps_ground_advantage",
  "USPS:GroundAdvantageCubic": "usps_ground_advantage",
  "USPS:Priority": "usps_priority",
  "USPS:PriorityMailCubic": "usps_priority",
  "UPS:Ground": "ups_ground",
};

/** Never offered, whatever the map says (decision 13: never air or overnight). */
export const NEVER_OFFERED = /air|express|overnight|next ?day|2nd ?day|3 ?day|saver|early|priority ?overnight/i;

/** At most this many options reach the buyer (decision 13). */
const MAX_OPTIONS = 3;

interface EasyPostRate {
  id?: unknown;
  carrier?: unknown;
  service?: unknown;
  rate?: unknown;
  currency?: unknown;
  delivery_days?: unknown;
  shipment_id?: unknown;
}

interface ShipQuote {
  service: ShipService;
  providerCarrier: string;
  providerService: string;
  rateCents: number;
  providerRateId: string;
  providerShipmentId: string;
  deliveryDays: number | null;
}

interface OfferedQuote extends ShipQuote {
  preselected: boolean;
}

/** "7.33" -> 733. Only plain non-negative dollar strings with at most 2 decimals; anything else -> null. */
export function dollarsToCents(v: unknown): number | null {
  if (typeof v !== "string") return null;
  const m = /^(\d{1,6})(?:\.(\d{1,2}))?$/.exec(v.trim());
  if (!m) return null;
  const cents = Number(m[1]) * 100 + Number((m[2] ?? "").padEnd(2, "0"));
  return Number.isSafeInteger(cents) ? cents : null;
}

const cheapestFirst = (a: ShipQuote, b: ShipQuote) => a.rateCents - b.rateCents || a.providerRateId.localeCompare(b.providerRateId);

/** Every allowed rate in a shipment response, cheapest first. */
export function allowedQuotes(rates: EasyPostRate[] | null | undefined): ShipQuote[] {
  const out: ShipQuote[] = [];
  for (const r of rates ?? []) {
    if (typeof r?.carrier !== "string" || typeof r.service !== "string" || r.currency !== "USD") continue;
    if (NEVER_OFFERED.test(r.service)) continue;
    const service = SERVICE_MAP[`${r.carrier}:${r.service}`];
    const cents = dollarsToCents(r.rate);
    if (!service || cents === null || cents <= 0) continue;
    if (typeof r.id !== "string" || !r.id.startsWith("rate_")) continue;
    if (typeof r.shipment_id !== "string" || !r.shipment_id.startsWith("shp_")) continue;
    out.push({
      service,
      providerCarrier: r.carrier,
      providerService: r.service,
      rateCents: cents,
      providerRateId: r.id,
      providerShipmentId: r.shipment_id,
      deliveryDays: Number.isInteger(r.delivery_days) ? (r.delivery_days as number) : null,
    });
  }
  return out.sort(cheapestFirst);
}

/** What the buyer is offered: the cheapest of each allowed service, cheapest first, at most 3, the first pre-selected. */
export function offeredQuotes(rates: EasyPostRate[] | null | undefined): OfferedQuote[] {
  const best = new Map<ShipService, ShipQuote>();
  for (const q of allowedQuotes(rates)) if (!best.has(q.service)) best.set(q.service, q);
  // allowedQuotes is cheapest first and the map keeps the first (cheapest) of each service, in that order.
  return [...best.values()].slice(0, MAX_OPTIONS).map((q, i) => ({ ...q, preselected: i === 0 }));
}

/** The EasyPost key for an order's Stripe mode: test orders use ONLY the test key (money review fix 8). */
export function easypostKeyName(mode: "test" | "live"): "EASYPOST_TEST_API_KEY" | "EASYPOST_API_KEY" {
  return mode === "live" ? "EASYPOST_API_KEY" : "EASYPOST_TEST_API_KEY";
}

/**
 * Every EasyPost object carries the mode of the key that made it ("mode": "test" in the docs' Rate example,
 * docs.easypost.com/docs/shipments/rates). A response whose mode is not the order's mode is refused, so a
 * mis-pasted secret (a production key under the test name) can never quote, let alone buy, real postage.
 * (Key prefixes are not documented by EasyPost, so the key text itself is not trusted for this.)
 */
export function responseModeMatches(obj: { mode?: unknown } | null | undefined, mode: "test" | "live"): boolean {
  return obj?.mode === mode;
}

/** The only address fields ever sent to EasyPost. No name, company, email or phone (spec 4.2). */
const ADDRESS_FIELDS = ["street1", "street2", "city", "state", "zip"] as const;
interface RateAddress { street1?: string; street2?: string; city?: string; state?: string; zip: string }
interface RateParcel { weightOz: number; lengthIn: number; widthIn: number; heightIn: number }

function addressOnly(a: RateAddress): Record<string, string> {
  const out: Record<string, string> = {};
  for (const k of ADDRESS_FIELDS) if (typeof a[k] === "string" && a[k]) out[k] = a[k];
  out.country = "US";
  return out;
}

/**
 * POST /v2/shipments body for a rate quote: both addresses + the parcel "will automatically populate its rates"
 * (docs.easypost.com/docs/shipments, read 2026-10-30). The box dimensions are always sent so USPS Cubic is quoted
 * whenever the parcel qualifies (decision 11). Whatever extra fields a caller passes are dropped.
 */
export function buildRateRequest(to: RateAddress, from: RateAddress, parcel: RateParcel) {
  return {
    shipment: {
      to_address: addressOnly(to),
      from_address: addressOnly(from),
      parcel: { length: parcel.lengthIn, width: parcel.widthIn, height: parcel.heightIn, weight: parcel.weightOz },
    },
  };
}

/** Paths of any email or phone field anywhere in a request (case-insensitive). ship-rates refuses to send unless []. */
export function memberContactInRequest(body: unknown, path = ""): string[] {
  if (body === null || typeof body !== "object") return [];
  const found: string[] = [];
  for (const [k, v] of Object.entries(body as Record<string, unknown>)) {
    const p = path ? `${path}.${k}` : k;
    if (/^(email|phone)$/i.test(k)) found.push(p);
    found.push(...memberContactInRequest(v, p));
  }
  return found;
}

/**
 * The parcel presets a seller picks for a small item (spec 6: conservative weights, Envelope up to 8 oz, Small box
 * up to 1 lb, Medium box up to 3 lb, Large box up to 10 lb; no side over 22 in, so no USPS length surcharge). Each
 * preset is quoted at its MAX weight (a conservative quote, never an under-paid label). Box sizes are common stock
 * sizes; the S3 listing form shows them to the seller. Stored as declutter_items.ship_preset (20261030012052).
 */
export const PARCEL_PRESETS = {
  envelope: { weightOz: 8, lengthIn: 12, widthIn: 9, heightIn: 1 },
  small_box: { weightOz: 16, lengthIn: 9, widthIn: 6, heightIn: 3 },
  medium_box: { weightOz: 48, lengthIn: 12, widthIn: 9, heightIn: 6 },
  large_box: { weightOz: 160, lengthIn: 18, widthIn: 14, heightIn: 8 },
} as const satisfies Record<string, RateParcel>;
type ParcelPreset = keyof typeof PARCEL_PRESETS;
const PRESET_ORDER: ParcelPreset[] = ["envelope", "small_box", "medium_box", "large_box"];
/** A bundle too heavy for the large box: the largest parcel a seller may send (20 lb, 22 in; policy.ts MAX_PARCEL). */
export const CUSTOM_BOX = { weightOz: 320, lengthIn: 22, widthIn: 14, heightIn: 10 } as const;
/** The extra box a bundle is packed in (decision 10: the items' preset weights + the box). */
const BUNDLE_BOX_OZ = 8;

/**
 * One parcel for a seller's bundle (decision 10: one label per bundle, never one per item). One item: its preset.
 * Several: weight = sum of the presets' weights + the box; the smallest box (never an envelope) that holds that
 * weight, else the 20 lb custom box. (Presets are max weights, so the sum always outweighs the biggest item's own
 * box and the chosen box is never smaller than it.) Over 20 lb, or any item with
 * no preset: null, and ship-rates refuses the quote (never a guessed, under-paid label).
 */
export function bundleParcel(presets: ReadonlyArray<string | null | undefined>): RateParcel | null {
  if (presets.length === 0) return null;
  const ranks: number[] = [];
  for (const p of presets) {
    const r = PRESET_ORDER.indexOf(p as ParcelPreset);
    if (r < 0) return null;
    ranks.push(r);
  }
  if (presets.length === 1) return { ...PARCEL_PRESETS[PRESET_ORDER[ranks[0]]] };
  const weightOz = ranks.reduce((s, r) => s + PARCEL_PRESETS[PRESET_ORDER[r]].weightOz, 0) + BUNDLE_BOX_OZ;
  if (weightOz > CUSTOM_BOX.weightOz) return null;
  for (let r = 1; r < PRESET_ORDER.length; r++) {
    const box = PARCEL_PRESETS[PRESET_ORDER[r]];
    if (weightOz <= box.weightOz) return { ...box, weightOz };
  }
  return { ...CUSTOM_BOX, weightOz };
}

/** Same rule as src/lib/shipping/policy.ts isLouisianaZip (a vitest sweep over every ZIP keeps the two equal). */
const LA_ZIP = /^(70[013-8]|71[0-4])[0-9]{2}$/;

/**
 * The seller's ZIP from their one-line pickup address (declutter_item_private.pickup_address is free text): the
 * LAST Louisiana 5-digit ZIP in it (a house number like 12345 comes first). Null when there is none: no quote.
 */
export function louisianaZipIn(line: string | null | undefined): string | null {
  if (typeof line !== "string") return null;
  const zips = [...line.matchAll(/(?<![0-9])([0-9]{5})(?:-[0-9]{4})?(?![0-9])/g)].map((m) => m[1]).filter((z) => LA_ZIP.test(z));
  return zips.length ? zips[zips.length - 1] : null;
}

type ShipToResult = { ok: true; address: RateAddress } | { ok: false; error: "address_incomplete" | "louisiana_only" };

/** The buyer's ship-to from the request body: a Louisiana street address, trimmed and capped; nothing else is kept. */
export function shipToFromBody(body: unknown): ShipToResult {
  const b = (body && typeof body === "object" ? body : {}) as Record<string, unknown>;
  const text = (v: unknown, max: number) => (typeof v === "string" && v.trim().length > 0 && v.trim().length <= max ? v.trim() : null);
  const street1 = text(b.street1, 100);
  const street2 = b.street2 == null || b.street2 === "" ? undefined : text(b.street2, 100);
  const city = text(b.city, 60);
  const state = text(b.state, 2)?.toUpperCase() ?? null;
  const zip = text(b.zip, 10);
  if (!street1 || street2 === null || !city || !state || !zip) return { ok: false, error: "address_incomplete" };
  if (state !== "LA" || !/^[0-9]{5}(-[0-9]{4})?$/.test(zip) || !LA_ZIP.test(zip.slice(0, 5))) return { ok: false, error: "louisiana_only" };
  return { ok: true, address: { street1, ...(street2 ? { street2 } : {}), city, state, zip } };
}
