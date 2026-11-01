/**
 * LEAD-PRICE-LOOKUP (owner 2026-10-31): the used-price lookup, with the model call mocked.
 * @mutate supabase/functions/declutter-ai-draft/priceLookup.ts |   return Math.max(1, Math.min(1000, Math.round(r.low + (r.high - r.low) * 0.8))); |   return Math.max(1, Math.min(1000, Math.round((r.low + r.high) / 2)));
 * @mutate supabase/functions/declutter-ai-draft/priceLookup.ts |         tools: [{ type: "web_search_20260209", name: "web_search", max_uses: LOOKUP_MAX_SEARCHES }], |         tools: [],
 * @mutate supabase/functions/declutter-ai-draft/priceLookup.ts |   if (draft.flagged \|\| !draft.title.trim()) return estimate(); |   if (!draft.title.trim()) return estimate();
 * @mutate supabase/functions/declutter-ai-draft/priceLookup.ts | const LOOKUP_MAX_SEARCHES = 1; | const LOOKUP_MAX_SEARCHES = 3;
 * @mutate supabase/functions/declutter-ai-draft/priceLookup.ts |   const parts = [item.title.trim(), ...labels, ...rest] |   const parts = [item.title.trim(), ...rest, ...labels]
 * @mutate supabase/functions/declutter-ai-draft/priceLookup.ts |     draft.priceDollars === null ? draft : { | true ? draft : {
 * @mutate supabase/functions/declutter-ai-draft/priceLookup.ts | draft.priceReason ? estimateReason(draft.priceReason) : "Our estimate." | draft.priceReason
 * @mutate supabase/functions/declutter-ai-draft/priceLookup.ts |       console.warn("[price-lookup]", res.status, | console.debug("[price-lookup]", res.status,
 * @mutate supabase/functions/declutter-ai-draft/priceLookup.ts |     console.warn("[price-lookup] failed", (e as Error)?.name); |     console.debug("[price-lookup] failed", (e as Error)?.name);
 * @mutate supabase/functions/declutter-ai-draft/index.ts |   return json(draftAnswer(await groundWithOurSales(anon, await priceDraftFromLookup(ANTHROPIC_API_KEY, draft), body)));\n} |   return json(draftAnswer(await groundWithOurSales(anon, draft, body)));\n}
 * @mutate supabase/functions/declutter-ai-draft/index.ts |     const { flagReason: _reason, ...d } = await groundWithOurSales(anon, await priceDraftFromLookup(ANTHROPIC_API_KEY, draft), body); |     const { flagReason: _reason, ...d } = await groundWithOurSales(anon, draft, body);
 * @mutate supabase/functions/declutter-ai-draft/index.ts |     return json(draftAnswer(await groundWithOurSales(anon, await priceDraftFromLookup(ANTHROPIC_API_KEY, draft), body)));\n  } catch (e) { |     return json(draftAnswer(await groundWithOurSales(anon, draft, body)));\n  } catch (e) {
 */
import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import {
  lookupQuery, lookupReason, lookupUsedPrice, priceDraftFromLookup, priceFromRange, rangeFromAnswer,
} from "../../supabase/functions/declutter-ai-draft/priceLookup";
import { blankComments } from "./helpers/blankNonCode";

const answer = (text: string) => new Response(JSON.stringify({ stop_reason: "end_turn", content: [
  { type: "server_tool_use", id: "s1", name: "web_search", input: { query: "used oak rocking chair price" } },
  { type: "web_search_tool_result", tool_use_id: "s1", content: [] },
  { type: "text", text },
] }), { status: 200 });

describe("used-price lookup (LEAD-PRICE-LOOKUP)", () => {
  it("asks with web search, only the item's words, and uses the range it finds", async () => {
    const fetchImpl = vi.fn(async () => answer('{"low": 40, "high": 90}'));
    const r = await lookupUsedPrice("k", { title: "Oak rocking chair", details: "Brand: Amish made", conditionStars: 4 }, { fetchImpl: fetchImpl as unknown as typeof fetch });
    expect(r).toEqual({ low: 40, high: 90 });
    const body = JSON.parse((fetchImpl.mock.calls[0] as unknown as [string, RequestInit])[1].body as string);
    expect(body.tools).toEqual([{ type: "web_search_20260209", name: "web_search", max_uses: 1 }]);
    // Never a photo or member data: one text block, the item's words only.
    expect(body.messages[0].content).toEqual([{ type: "text", text: "Oak rocking chair. Brand: Amish made. Used, very good condition." }]);
    expect(JSON.stringify(body)).not.toMatch(/"image"|base64/);
    expect(priceFromRange(r!)).toBe(80);
    expect(lookupReason(r!)).toBe("Based on similar used items selling for $40-$90.");
  });

  it("a lookup that runs past its time box gives null, so the caller keeps its estimate", async () => {
    const fetchImpl = vi.fn((_u: string, init: RequestInit) => new Promise<Response>((_res, rej) => {
      init.signal?.addEventListener("abort", () => rej(new DOMException("aborted", "AbortError")));
    }));
    const t0 = Date.now();
    const r = await lookupUsedPrice("k", { title: "Lamp" }, { fetchImpl: fetchImpl as unknown as typeof fetch, timeoutMs: 50 });
    expect(r).toBeNull();
    expect(Date.now() - t0).toBeLessThan(1000);
  });

  it("no usable range (none found, refusal, HTTP error, junk) is null", async () => {
    expect(rangeFromAnswer({ stop_reason: "end_turn", content: [{ type: "text", text: '{"low": 0, "high": 0}' }] })).toBeNull();
    expect(rangeFromAnswer({ stop_reason: "refusal", content: [] })).toBeNull();
    expect(rangeFromAnswer({ stop_reason: "end_turn", content: [{ type: "text", text: "no idea" }] })).toBeNull();
    const bad = vi.fn(async () => new Response("{}", { status: 529 }));
    expect(await lookupUsedPrice("k", { title: "Lamp" }, { fetchImpl: bad as unknown as typeof fetch })).toBeNull();
    expect(lookupQuery({ title: "Lamp" })).toBe("Lamp. Used.");
  });

  it("a rejected or failed lookup is never silent: the edge log gets its status, or the error's name", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      const rejected = vi.fn(async () => new Response('{"type":"error","error":{"type":"invalid_request_error","message":"tool not allowed"}}', { status: 400 }));
      expect(await lookupUsedPrice("k", { title: "Lamp" }, { fetchImpl: rejected as unknown as typeof fetch })).toBeNull();
      expect(warn).toHaveBeenCalledWith("[price-lookup]", 400, expect.stringContaining("tool not allowed"));
      warn.mockClear();
      const hangs = vi.fn((_u: string, init: RequestInit) => new Promise<Response>((_res, rej) => {
        init.signal?.addEventListener("abort", () => rej(new DOMException("aborted", "AbortError")));
      }));
      expect(await lookupUsedPrice("k", { title: "Lamp" }, { fetchImpl: hangs as unknown as typeof fetch, timeoutMs: 20 })).toBeNull();
      expect(warn).toHaveBeenCalledWith("[price-lookup] failed", "AbortError");
    } finally {
      warn.mockRestore();
    }
  });

  const draft = (over: Record<string, unknown> = {}) => ({
    title: "Oak rocking chair", description: "Solid oak, light wear.", conditionStars: 4, flagged: false,
    priceDollars: 60, priceReason: "Solid wood and only light wear.", ...over,
  });

  it("a draft takes the looked-up price and its numbers-only reason", async () => {
    const fetchImpl = vi.fn(async () => answer('{"low": 40, "high": 90}'));
    const d = await priceDraftFromLookup("k", draft(), { fetchImpl: fetchImpl as unknown as typeof fetch });
    expect(d.priceDollars).toBe(80);
    expect(d.priceReason).toBe("Based on similar used items selling for $40-$90.");
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("no lookup answer keeps the model's price, labelled Our estimate", async () => {
    const none = vi.fn(async () => answer('{"low": 0, "high": 0}'));
    const d = await priceDraftFromLookup("k", draft(), { fetchImpl: none as unknown as typeof fetch });
    expect(d.priceDollars).toBe(60);
    expect(d.priceReason).toBe("Our estimate: Solid wood and only light wear.");
    const bare = await priceDraftFromLookup("k", draft({ priceReason: null }), { fetchImpl: none as unknown as typeof fetch });
    expect(bare.priceReason).toBe("Our estimate.");
  });

  it("a flagged item is never looked up; a draft the model left unpriced is looked up, and keeps none (never $0) without a range", async () => {
    const fetchImpl = vi.fn(async () => answer('{"low": 40, "high": 90}'));
    const flagged = await priceDraftFromLookup("k", draft({ flagged: true }), { fetchImpl: fetchImpl as unknown as typeof fetch });
    expect(flagged.priceDollars).toBe(60);
    expect(flagged.priceReason).toMatch(/^Our estimate/);
    expect(fetchImpl).not.toHaveBeenCalled();
    // Owner 10-31: several bunch items came out with no price. The lookup prices them now.
    const unpriced = await priceDraftFromLookup("k", draft({ priceDollars: null, priceReason: null }), { fetchImpl: fetchImpl as unknown as typeof fetch });
    expect(unpriced.priceDollars).toBe(80);
    expect(unpriced.priceReason).toBe("Based on similar used items selling for $40-$90.");
    const none = vi.fn(async () => answer('{"low": 0, "high": 0}'));
    const still = await priceDraftFromLookup("k", draft({ priceDollars: null, priceReason: null }), { fetchImpl: none as unknown as typeof fetch });
    expect(still.priceDollars).toBeNull();
    expect(still.priceReason).toBeNull();
  });

  it("owner 10-31 drafts: ONE search, the label line right after the title, sold used prices, priced near the top", async () => {
    // Mocked model answers (the real API cannot be called locally): what each lookup is SENT is the measurement.
    const OWNER_DRAFTS: [string, string, number, number, number][] = [
      ["Blue exercise stability ball", "Brand: Gaiam. Size: 65 cm\nInflated, no punctures.", 8, 20, 18],
      ["Natra Cure gel booties", "Brand: NatraCure\nUsed twice.", 8, 18, 16],
      ["3-tier letter trays", "Stackable mesh trays.", 8, 15, 14],
      ["Heated eye mask", "Brand: Sunbeam. Model: USB\nWorks.", 10, 22, 20],
      ["Brass cup drawer pulls in box", "Set of 12 in the box.", 25, 60, 53],
      ["Christmas decor lot", "Ornaments and garland.", 15, 40, 35],
    ];
    for (const [title, details, low, high, expected] of OWNER_DRAFTS) {
      const fetchImpl = vi.fn(async () => answer(`{"low": ${low}, "high": ${high}}`));
      const out = await priceDraftFromLookup("k", draft({ title, description: details, priceDollars: 5 }), { fetchImpl: fetchImpl as unknown as typeof fetch });
      const body = JSON.parse((fetchImpl.mock.calls[0] as unknown as [string, RequestInit])[1].body as string);
      expect(body.tools).toEqual([{ type: "web_search_20260209", name: "web_search", max_uses: 1 }]);
      expect(body.system).toMatch(/ONE web search/);
      expect(body.system).toMatch(/SOLD prices of this exact item/);
      expect(body.system).toMatch(/brand and model/);
      expect(body.system).toMatch(/Never use new or retail prices/);
      const text: string = body.messages[0].content[0].text;
      expect(text.startsWith(`${title}.`)).toBe(true);
      const label = details.split("\n")[0];
      if (/Brand:/.test(label)) expect(text.indexOf(label.replace(/\.$/, ""))).toBe(title.length + 2);
      expect(out.priceDollars).toBe(expected);
      expect(out.priceDollars).toBeGreaterThan(5);
    }
  });

  it("Sell a bunch: three lookups run at once, so three items take about one lookup's time", async () => {
    const slow = vi.fn(() => new Promise<Response>((res) => setTimeout(() => res(answer('{"low": 10, "high": 20}')), 300)));
    const t0 = Date.now();
    const out = await Promise.all([1, 2, 3].map(() => priceDraftFromLookup("k", draft(), { fetchImpl: slow as unknown as typeof fetch })));
    const took = Date.now() - t0;
    expect(out.map((d) => d.priceDollars)).toEqual([18, 18, 18]);
    expect(slow).toHaveBeenCalledTimes(3);
    expect(took).toBeLessThan(800);
  });

  it("every draft path in the edge function prices through the lookup (source)", () => {
    const src = blankComments(readFileSync("supabase/functions/declutter-ai-draft/index.ts", "utf8"));
    const uses = src.match(/groundWithOurSales\(anon, await priceDraftFromLookup\(ANTHROPIC_API_KEY, draft\), body\)/g) ?? [];
    // The saved draft, the photos draft and Sell a bunch.
    expect(uses.length).toBe(3);
    expect(src.match(/groundWithOurSales\(/g)?.length).toBe(4); // the 3 calls + its definition
    expect(src).toMatch(/Promise\.all\(items\.map\(async[^]*?priceDraftFromLookup/);
  });
});
