/**
 * declutter-ai-draft tries the photo model ONCE more when it answers 503 or
 * 529 ("high demand", 2026-10-15 06:12Z on prod), and never otherwise. A
 * second busy answer still ends in the same `ai_unavailable` message.
 *
 * @mutate supabase/functions/declutter-ai-draft/modelRetry.ts | new Set([503, 529]) | new Set([])
 * @mutate supabase/functions/declutter-ai-draft/modelRetry.ts | export const MAX_ATTEMPTS = 2; | export const MAX_ATTEMPTS = 3;
 * @mutate supabase/functions/declutter-ai-draft/index.ts |   return fetchModelWithRetry(callModel, { |   return callModel(); ({
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { blankComments } from "./helpers/blankNonCode";
import { fetchModelWithRetry, MAX_ATTEMPTS, RETRY_DELAY_MS } from "../../supabase/functions/declutter-ai-draft/modelRetry";

/** A model that answers each status in turn, counting calls. */
function model(...statuses: number[]) {
  let calls = 0;
  const attempt = () => {
    const status = statuses[Math.min(calls, statuses.length - 1)];
    calls++;
    return Promise.resolve(new Response(JSON.stringify({ status }), { status }));
  };
  return { attempt, calls: () => calls };
}

const noSleep = () => {
  const waits: number[] = [];
  return { sleep: (ms: number) => { waits.push(ms); return Promise.resolve(); }, waits };
};

describe("declutter-ai-draft model retry", () => {
  it("retries a 503 once, after a pause, and returns the second answer", async () => {
    const m = model(503, 200);
    const s = noSleep();
    const res = await fetchModelWithRetry(m.attempt, { sleep: s.sleep });
    expect(res.status).toBe(200);
    expect(m.calls()).toBe(2);
    expect(s.waits).toEqual([RETRY_DELAY_MS]);
    expect(RETRY_DELAY_MS).toBeGreaterThan(0);
  });

  it("retries a 529 once", async () => {
    const m = model(529, 200);
    const res = await fetchModelWithRetry(m.attempt, { sleep: noSleep().sleep });
    expect(res.status).toBe(200);
    expect(m.calls()).toBe(2);
  });

  it("is bounded: two busy answers end with the busy answer (so ai_unavailable), never a third call", async () => {
    const m = model(503, 503, 503, 200);
    const res = await fetchModelWithRetry(m.attempt, { sleep: noSleep().sleep });
    expect(res.status).toBe(503);
    expect(m.calls()).toBe(2);
    expect(MAX_ATTEMPTS).toBe(2);
  });

  it.each([200, 400, 401, 429, 500, 502, 504])("never retries a %i", async (status) => {
    const m = model(status, 200);
    const s = noSleep();
    const res = await fetchModelWithRetry(m.attempt, { sleep: s.sleep });
    expect(res.status).toBe(status);
    expect(m.calls()).toBe(1);
    expect(s.waits).toEqual([]);
  });

  it("the function sends its model call through the retry, and keeps one user message for a failure", () => {
    const src = blankComments(readFileSync(resolve(__dirname, "../../supabase/functions/declutter-ai-draft/index.ts"), "utf8"));
    expect(src).toMatch(/fetchModelWithRetry\(callModel\b/);
    // Exactly one place calls the model endpoint, and it is inside callModel.
    const calls = src.match(/generativelanguage\.googleapis\.com/g) ?? [];
    expect(calls.length).toBe(1);
    expect(src.indexOf("const callModel")).toBeLessThan(src.indexOf("generativelanguage.googleapis.com"));
    // A failure after the retry is still the same answer the app maps to
    // "The photo tool isn't available right now".
    expect(src).toMatch(/if \(!response\.ok\) \{[\s\S]{0,300}error: "ai_unavailable"/);
  });
});
