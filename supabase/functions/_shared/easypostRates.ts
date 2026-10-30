/**
 * EasyPost rates for Declutter shipping (docs/specs/shipping-draft.md S2 rates, sections 3, 4.2, 5.2; Q2259).
 * Pure: no network, no Deno APIs, so vitest runs it on recorded responses. ship-rates (S2) calls EasyPost and
 * hands the response here; the label worker (S5) re-checks the chosen rate with shipping_rate_buyable.
 *
 * Rules:
 *  - USPS only, the services the spec allows: Ground Advantage (the default; cubic pricing included when EasyPost
 *    returns it for the box) and Priority (the faster option). Anything else is dropped, never shown.
 *  - EasyPost's dollar strings become integer cents exactly ("7.33" -> 733), never through a float multiply.
 *    A malformed amount drops that rate (never a guess).
 *  - Rate shown = rate charged = rate bought: the quote carries the provider's rate id and shipment id, and the
 *    amount the buyer pays is exactly the rate (EasyPost's label fee is $0 under 3,000 labels a month, spec 2).
 *  - The key follows the order's Stripe mode, never the other one (money review fix 8).
 */

export type ShipService = "usps_ground_advantage" | "usps_priority";

/** EasyPost USPS service names we accept, mapped to ours. Cubic names are listed so a cubic rate is never dropped. */
const SERVICE_MAP: Record<string, ShipService> = {
  GroundAdvantage: "usps_ground_advantage",
  GroundAdvantageCubic: "usps_ground_advantage",
  Priority: "usps_priority",
  PriorityMailCubic: "usps_priority",
};

export interface EasyPostRate {
  id?: unknown;
  carrier?: unknown;
  service?: unknown;
  rate?: unknown;
  currency?: unknown;
  delivery_days?: unknown;
  shipment_id?: unknown;
}

export interface ShipQuote {
  service: ShipService;
  providerService: string;
  rateCents: number;
  providerRateId: string;
  providerShipmentId: string;
  deliveryDays: number | null;
}

/** "7.33" -> 733. Only plain non-negative dollar strings with at most 2 decimals; anything else -> null. */
export function dollarsToCents(v: unknown): number | null {
  if (typeof v !== "string") return null;
  const m = /^(\d{1,6})(?:\.(\d{1,2}))?$/.exec(v.trim());
  if (!m) return null;
  const cents = Number(m[1]) * 100 + Number((m[2] ?? "").padEnd(2, "0"));
  return Number.isSafeInteger(cents) ? cents : null;
}

/** Every allowed USPS rate in a shipment response, cheapest first. */
export function allowedQuotes(rates: EasyPostRate[] | null | undefined): ShipQuote[] {
  const out: ShipQuote[] = [];
  for (const r of rates ?? []) {
    if (r?.carrier !== "USPS" || typeof r.service !== "string" || r.currency !== "USD") continue;
    const service = SERVICE_MAP[r.service];
    const cents = dollarsToCents(r.rate);
    if (!service || cents === null || cents <= 0) continue;
    if (typeof r.id !== "string" || !r.id.startsWith("rate_")) continue;
    if (typeof r.shipment_id !== "string" || !r.shipment_id.startsWith("shp_")) continue;
    out.push({
      service,
      providerService: r.service,
      rateCents: cents,
      providerRateId: r.id,
      providerShipmentId: r.shipment_id,
      deliveryDays: Number.isInteger(r.delivery_days) ? (r.delivery_days as number) : null,
    });
  }
  return out.sort((a, b) => a.rateCents - b.rateCents || a.providerRateId.localeCompare(b.providerRateId));
}

/** What the buyer is offered: the cheapest of each service (Ground Advantage first as the default). */
export function offeredQuotes(rates: EasyPostRate[] | null | undefined): ShipQuote[] {
  const best = new Map<ShipService, ShipQuote>();
  for (const q of allowedQuotes(rates)) if (!best.has(q.service)) best.set(q.service, q);
  return (["usps_ground_advantage", "usps_priority"] as const).flatMap((s) => (best.has(s) ? [best.get(s)!] : []));
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
