/**
 * EVERY POSTED LISTING GETS ITS CHECK RECORDED (owner 10-31 ~9:15 PM: 27 of a Sell a bunch post were held by the
 * 15-minute fail-safe, declutter_item_private.ai_checked_at NULL). Measured in the edge request logs 02:18-02:21Z
 * (B50, read-only Management API): 12 calls in a minute answered 200, then 40+ in a row answered 429. The checks shared
 * the 12-a-minute "declutter-ai-draft" bucket, the app asked again at once (both tries in the same full minute), and
 * every refused try still counted, so the bucket never emptied while the bunch kept checking.
 *
 * (a) a check counts against its OWN bucket, with room for a bunch; drafts keep 12 a minute;
 * (b) the edge function picks the bucket from the body, read before the limit, and caps checks per hour too;
 * (c) the app's retry waits 5 s, 20 s, 60 s between up to 4 tries (never two tries in the same moment);
 * (d) the check path never waits on the price lookup (price is a draft's concern only).
 *
 * @mutate supabase/functions/declutter-ai-draft/checkLimits.ts | keyPrefix: "declutter-ai-check" }; | keyPrefix: "declutter-ai-draft" };
 * @mutate supabase/functions/declutter-ai-draft/index.ts |   const isCheck = body?.mode === "check"; |   const isCheck = false;
 * @mutate src/lib/declutter/api.ts |       if (attempt < tries) await wait(CHECK_RETRY_WAITS_MS[Math.min(attempt - 1, CHECK_RETRY_WAITS_MS.length - 1)]); |
 * @mutate src/lib/declutter/api.ts |   { tries = CHECK_RETRY_WAITS_MS.length + 1, |   { tries = 2,
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { blankComments } from "./helpers/blankNonCode";

const invoke = vi.hoisted(() => vi.fn());
vi.mock("@/integrations/supabase/client", () => ({ supabase: { functions: { invoke } } }));

import { CHECK_HOURLY_LIMIT, CHECK_MINUTE_LIMIT } from "../../supabase/functions/declutter-ai-draft/checkLimits";
import { CHECK_RETRY_WAITS_MS, requestAiCheckWithRetry } from "@/lib/declutter/api";

const ROOT = resolve(__dirname, "../..");
const busy = () => ({ data: null, error: { name: "FunctionsHttpError", context: { status: 429, json: async () => ({ error: "rate_limited" }) } } });

beforeEach(() => invoke.mockReset());

describe("a posted listing's check is never starved by the shared limit", () => {
  it("(a) checks have their own bucket with room for a bunch; drafts keep 12 a minute", () => {
    const src = blankComments(readFileSync(resolve(ROOT, "supabase/functions/declutter-ai-draft/index.ts"), "utf8"));
    expect(CHECK_MINUTE_LIMIT.keyPrefix).toBe("declutter-ai-check");
    expect(src).toMatch(/windowMs: 60_000, maxRequests: 12, keyPrefix: "declutter-ai-draft"/);
    // Sell a bunch paces checks every 5.25 s (AI_CHECK_GAP_MS): ~11.4 a minute, each retried up to 3 times.
    expect(CHECK_MINUTE_LIMIT.maxRequests).toBeGreaterThanOrEqual(30);
    expect(CHECK_HOURLY_LIMIT.keyPrefix).not.toBe(CHECK_MINUTE_LIMIT.keyPrefix);
    expect(CHECK_HOURLY_LIMIT.maxRequests).toBeGreaterThanOrEqual(100);
  });

  it("(b) the edge function reads the body before the limit and sends a check to its own bucket", () => {
    const src = blankComments(readFileSync(resolve(ROOT, "supabase/functions/declutter-ai-draft/index.ts"), "utf8"));
    const serveAt = src.indexOf("serve(async (req) => {");
    const bodyAt = src.indexOf("const body = await req.json()", serveAt);
    const pickAt = src.indexOf('const isCheck = body?.mode === "check";', serveAt);
    const limitAt = src.indexOf("? await checkRateLimit(req, CHECK_MINUTE_LIMIT)", serveAt);
    expect(serveAt).toBeGreaterThan(0);
    expect(bodyAt).toBeGreaterThan(serveAt);
    expect(pickAt).toBeGreaterThan(bodyAt);
    expect(limitAt).toBeGreaterThan(pickAt);
    expect(src.indexOf("checkRateLimit(req, CHECK_HOURLY_LIMIT)", serveAt)).toBeGreaterThan(limitAt);
    // One body read only (a second req.json() would read an empty stream).
    expect(src.slice(serveAt).match(/await req\.json\(\)/g)).toHaveLength(1);
  });

  it("(c) the app retries a busy check after 5 s, 20 s, 60 s, never twice at once", async () => {
    expect(CHECK_RETRY_WAITS_MS).toEqual([5_000, 20_000, 60_000]);
    invoke.mockResolvedValueOnce(busy()).mockResolvedValueOnce(busy()).mockResolvedValueOnce(busy()).mockResolvedValueOnce({ data: { checked: true, flagged: false }, error: null });
    const waits: number[] = [];
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const out = await requestAiCheckWithRetry("i1", { wait: async (ms) => { waits.push(ms); } });
    expect(out).toEqual({ checked: true, flagged: false });
    expect(invoke).toHaveBeenCalledTimes(4);
    expect(waits).toEqual([5_000, 20_000, 60_000]);
    invoke.mockReset();
    invoke.mockResolvedValue(busy());
    waits.length = 0;
    expect(await requestAiCheckWithRetry("i1", { wait: async (ms) => { waits.push(ms); } })).toBeNull();
    expect(invoke).toHaveBeenCalledTimes(4);
  });

  it("(d) the check path never waits on the price lookup", () => {
    const src = blankComments(readFileSync(resolve(ROOT, "supabase/functions/declutter-ai-draft/index.ts"), "utf8"));
    const checkAt = src.indexOf('admin.rpc("declutter_record_ai_check"');
    const returnAt = src.indexOf("return json({ checked: true, flagged: draft.flagged });", checkAt);
    const priceAt = src.indexOf("priceDraftFromLookup(", src.indexOf("serve(async (req) => {"));
    expect(checkAt).toBeGreaterThan(0);
    expect(returnAt).toBeGreaterThan(checkAt);
    expect(priceAt).toBeGreaterThan(returnAt);
  });
});
