/**
 * LEAD-PRICE-LOOKUP (owner 2026-10-31 ~14:17): a suggested price comes from a REAL lookup of similar USED items, not
 * only the model's guess from the photos. One Claude request per item with the server-side web search tool
 * (web_search_20260209, max_uses 3), time-boxed (8 s by default); no answer in time, or no usable range, and the
 * caller keeps today's estimate, labelled "Our estimate".
 *
 * What is sent: ONLY the item's words (title, details, condition). Never a photo, a name, an address or any other
 * member data. What comes back is a range in whole dollars; no store or marketplace name ever reaches a member:
 * the reason line is built here from the numbers alone.
 *
 * Pure (fetch and the clock are passed in) so src/test/declutterAiPriceLookup.test.ts runs it with the model mocked.
 * Called from index.ts through priceDraftFromLookup for the one-item draft (both the saved-draft and the photos
 * path) and for Sell a bunch, where every item's lookup runs at once (Promise.all), each in its own time box.
 */

const CLAUDE_URL = "https://api.anthropic.com/v1/messages";
const LOOKUP_MODEL = "claude-sonnet-5-5";
const LOOKUP_TIMEOUT_MS = 8_000;
// Owner 10-31 ("pricing suggestions ... pretty off"; the lead: "make 1 search count"): ONE search, aimed at the exact
// item, inside the same 8 s box (the live logs showed ~7.5 s lookups and AbortErrors with up to 3 searches).
const LOOKUP_MAX_SEARCHES = 1;

export type PriceRange = { low: number; high: number };
export type LookupItem = { title: string; details?: string | null; conditionStars?: number | null };

const CONDITION_WORDS: Record<number, string> = { 1: "poor", 2: "fair", 3: "good", 4: "very good", 5: "like new" };

/** A details line that names the exact item: brand, model, size or measurements read from a label. */
const LABEL_LINE = /\b(?:brand|model|size|made by)\s*:/i;

/** The only words the search sees: the item, never the member (owner rule). */
export function lookupQuery(item: LookupItem): string {
  // The labels read off the photos ("Brand: KitchenAid. Model: KSM150.", the draft's details line) come right after the
  // title, so the one search names the exact item (owner 10-31: suggestions were off for named things).
  const lines = (item.details ?? "").split(/\n+/).map((l) => l.trim()).filter(Boolean);
  const labels = lines.filter((l) => LABEL_LINE.test(l));
  const rest = lines.filter((l) => !LABEL_LINE.test(l));
  const parts = [item.title.trim(), ...labels, ...rest].filter(Boolean).join(". ").replace(/\.\./g, ".").slice(0, 300);
  const cond = item.conditionStars ? CONDITION_WORDS[item.conditionStars] : null;
  return cond ? `${parts}. Used, ${cond} condition.` : `${parts}. Used.`;
}

const SYSTEM = `You price ONE used item for a local resale listing in Louisiana. You have ONE web search: make it count. Search for SOLD prices of this exact item, used: put the brand and model (when given) and the item's name in the query, for example "Natra Cure gel booties used sold". Use sold listings first, then current used listings; if the exact item has none, use the closest same-kind items. Never use new or retail prices. Then answer with ONE line of JSON and nothing else: {"low": <whole dollars>, "high": <whole dollars>}, the range a used one in this condition really sells for. Read the range generously: sellers here ask near the top because buyers offer less, so "high" is what a well-kept one fetches, not a quick-sale price. Only when nothing comparable sells at all, answer {"low": 0, "high": 0}.`;

/** The last JSON object a text block carries, or null. Never throws. */
export function rangeFromAnswer(data: unknown): PriceRange | null {
  const d = data as { stop_reason?: string; content?: Array<{ type?: string; text?: string }> } | null;
  if (!d || d.stop_reason === "refusal" || d.stop_reason === "max_tokens" || !Array.isArray(d.content)) return null;
  const texts = d.content.filter((b) => b?.type === "text" && typeof b.text === "string").map((b) => b.text as string);
  for (let i = texts.length - 1; i >= 0; i--) {
    const m = texts[i].match(/\{[^{}]*"low"[^{}]*\}/g);
    if (!m) continue;
    try {
      const j = JSON.parse(m[m.length - 1]) as { low?: unknown; high?: unknown };
      const low = Math.round(Number(j.low));
      const high = Math.round(Number(j.high));
      if (Number.isFinite(low) && Number.isFinite(high) && low >= 1 && high >= low && high <= 10_000) return { low, high };
      return null;
    } catch {
      return null;
    }
  }
  return null;
}

/**
 * One time-boxed lookup. Null on a timeout, an HTTP error, a refusal or no usable range: the caller keeps its own
 * estimate. Never throws.
 */
export async function lookupUsedPrice(
  apiKey: string,
  item: LookupItem,
  opts: { fetchImpl?: typeof fetch; timeoutMs?: number } = {},
): Promise<PriceRange | null> {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), opts.timeoutMs ?? LOOKUP_TIMEOUT_MS);
  const started = Date.now();
  try {
    const res = await (opts.fetchImpl ?? fetch)(CLAUDE_URL, {
      signal: ctl.signal,
      method: "POST",
      headers: { "x-api-key": apiKey, "anthropic-version": "2023-06-01", "content-type": "application/json" },
      body: JSON.stringify({
        model: LOOKUP_MODEL,
        max_tokens: 1024,
        system: SYSTEM,
        messages: [{ role: "user", content: [{ type: "text", text: lookupQuery(item) }] }],
        tools: [{ type: "web_search_20260209", name: "web_search", max_uses: LOOKUP_MAX_SEARCHES }],
        output_config: { effort: "low" },
      }),
    });
    if (!res.ok) {
      // A rejected request (a tool or model the API refuses, a bad key, overload) is logged, never silent: otherwise every
      // price would quietly read "Our estimate". The body is the API's own error, never the item's words.
      console.warn("[price-lookup]", res.status, (await res.text().catch(() => "")).slice(0, 200));
      return null;
    }
    const answer = await res.json();
    const range = rangeFromAnswer(answer);
    // Numbers only (no item words): how long it took and how many web searches ran, so a live draft's log shows both.
    console.log("[price-lookup] done", JSON.stringify({
      ms: Date.now() - started, searches: answer?.usage?.server_tool_use?.web_search_requests ?? null, found: !!range,
    }));
    return range;
  } catch (e) {
    // A timeout shows as "AbortError", a network failure as its own name: no lookup, the caller's estimate stands.
    console.warn("[price-lookup] failed", (e as Error)?.name);
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/** PRICE_RULE (owner): the HIGH end of the real used range, never above it. */
export function priceFromRange(r: PriceRange): number {
  return Math.max(1, Math.min(1000, Math.round(r.low + (r.high - r.low) * 0.8)));
}

/** The member-facing reason: numbers only, so no store or marketplace name can appear. */
export function lookupReason(r: PriceRange): string {
  return r.low === r.high ? `Based on similar used items selling for about $${r.low}.` : `Based on similar used items selling for $${r.low}-$${r.high}.`;
}

/** The fallback label when no lookup answered. */
const estimateReason = (reason: string): string => `Our estimate: ${reason}`;

/** The fields of a draft the lookup reads and may change (DeclutterDraft and Sell a bunch's items both have them). */
export type PricedDraft = {
  title: string;
  description: string;
  conditionStars: number;
  flagged: boolean;
  priceDollars: number | null;
  priceReason: string | null;
};

/**
 * The draft's price from a real used-price lookup when one answers in time; otherwise the model's own price, its
 * reason labelled "Our estimate". A draft with no price is looked up too and keeps none without a range; a flagged item (it may not be sellable) is not
 * looked up. The lookup sees the draft's title and description (written by the model from the photos), its condition,
 * and nothing about the member. Never throws.
 */
export async function priceDraftFromLookup<D extends PricedDraft>(
  apiKey: string,
  draft: D,
  opts: { fetchImpl?: typeof fetch; timeoutMs?: number } = {},
): Promise<D> {
  // A draft the model gave no price still gets a lookup (owner 10-31: several bunch items came out with no price); with
  // no range either it keeps none, never $0, and the seller types one. A free item is never priced (its own toggle).
  const estimate = (): D =>
    draft.priceDollars === null ? draft : { ...draft, priceReason: draft.priceReason ? estimateReason(draft.priceReason) : "Our estimate." };
  if (draft.flagged || !draft.title.trim()) return estimate();
  const range = await lookupUsedPrice(apiKey, { title: draft.title, details: draft.description, conditionStars: draft.conditionStars }, opts);
  return range ? { ...draft, priceDollars: priceFromRange(range), priceReason: lookupReason(range) } : estimate();
}
