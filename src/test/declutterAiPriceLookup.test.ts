/**
 * LEAD-PRICE-LOOKUP (owner 2026-10-31): the used-price lookup, with the model call mocked.
 * @mutate supabase/functions/declutter-ai-draft/priceLookup.ts |   return Math.max(1, Math.min(1000, Math.round(r.low + (r.high - r.low) * 0.8))); |   return Math.max(1, Math.min(1000, Math.round((r.low + r.high) / 2)));
 * @mutate supabase/functions/declutter-ai-draft/priceLookup.ts |         tools: [{ type: "web_search_20260209", name: "web_search", max_uses: LOOKUP_MAX_SEARCHES }], |         tools: [],
 */
import { describe, expect, it, vi } from "vitest";
import {
  lookupQuery, lookupReason, lookupUsedPrice, priceFromRange, rangeFromAnswer,
} from "../../supabase/functions/declutter-ai-draft/priceLookup";

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
    expect(body.tools).toEqual([{ type: "web_search_20260209", name: "web_search", max_uses: 3 }]);
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
});
