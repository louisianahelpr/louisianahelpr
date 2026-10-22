/**
 * The AI job builder runs on Claude only (owner, 2026-10-22: "I'd rather just
 * use Claude", Sonnet 5.5; "just get rid of the Gemini one entirely"). Runs
 * the REAL function through the edge harness with the model call stubbed.
 *
 * Measured live 2026-10-22 (lead, one call): the exact request shape below
 * (structured output with JOB_POSTING_SCHEMA, effort low) answered 200
 * end_turn with a valid posting, 825 input / 286 output tokens.
 *
 * @mutate supabase/functions/_shared/claudeMessages.ts |   if (!d \|\| d.stop_reason === "refusal" \|\| d.stop_reason === "max_tokens") return null; |   if (!d) return null;
 * @mutate supabase/functions/_shared/claudeMessages.ts | const CLAUDE_MODEL = "claude-sonnet-5-5"; | const CLAUDE_MODEL = "claude-haiku-5-5";
 * @mutate supabase/functions/ai-job-builder/retry.ts | new Set([500, 502, 503, 529]) | new Set([500, 502, 503])
 * @mutate supabase/functions/ai-job-builder/index.ts |         if (claudeRes.status === 400 && /credit balance/i.test(detail)) { |         if (false) {
 * @mutate supabase/functions/ai-job-builder/index.ts | turns[turns.length - 1].role !== "user" | false
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { loadEdgeFunction } from "./harness";
import { setEnv, resetEnv } from "./mocks/deno-runtime";
import { scenario, resetSupabaseMock } from "./mocks/supabase";
import { resetSharedMocks } from "./mocks/shared";
import { resetStripeMock } from "./mocks/stripe";

const POSTING = {
  title: "Mow my lawn", description: "Front and back.", category: "yard_work",
  estimated_hours: 2, budget_min: 40, budget_max: 60,
};
const claudeAnswer = (over: Record<string, unknown> = {}) =>
  new Response(JSON.stringify({
    stop_reason: "end_turn",
    content: [{ type: "text", text: JSON.stringify(POSTING) }],
    ...over,
  }), { status: 200, headers: { "Content-Type": "application/json" } });

const ASK = [{ role: "user", content: "I need my lawn mowed this weekend" }];

async function run(reply: () => Response, messages: unknown[] = ASK) {
  const model = vi.fn().mockImplementation(() => Promise.resolve(reply()));
  vi.stubGlobal("fetch", model);
  const fn = await loadEdgeFunction("ai-job-builder");
  const res = await fn.fetch(fn.request({ headers: { Authorization: "Bearer good" }, body: { messages } }));
  return { res, model };
}

describe("ai-job-builder on Claude", () => {
  beforeEach(() => {
    resetSupabaseMock();
    resetSharedMocks();
    resetStripeMock();
    resetEnv();
    scenario.authUser = { id: "u-1", email: "user@test.dev" };
    setEnv({
      SUPABASE_URL: "https://x.supabase.co", SUPABASE_ANON_KEY: "anon-key", ANTHROPIC_API_KEY: "a-key",
    });
  });
  afterEach(() => vi.unstubAllGlobals());

  it("asks Claude Sonnet 5.5 for a structured answer and returns the posting", async () => {
    const { res, model } = await run(() => claudeAnswer());
    expect(res.status).toBe(200);
    expect((await res.json()).title).toBe("Mow my lawn");
    expect(model).toHaveBeenCalledTimes(1);
    const [url, init] = model.mock.calls[0] as [string, RequestInit];
    expect(new URL(url).hostname).toBe("api.anthropic.com");
    const headers = init.headers as Record<string, string>;
    expect(headers["x-api-key"]).toBe("a-key");
    expect(headers["anthropic-version"]).toBe("2023-06-01");
    const body = JSON.parse(String(init.body));
    expect(body.model).toBe("claude-sonnet-5-5");
    expect(body.output_config.format.type).toBe("json_schema");
    expect(body.output_config.format.schema.required).toContain("category");
    expect(body.tool_choice).toBeUndefined();
    expect(body.messages[0].content.at(-1)).toEqual({ type: "text", text: "I need my lawn mowed this weekend" });
  });

  it("a Claude refusal or a cut-off answer is a 502, never a half posting", async () => {
    for (const over of [{ stop_reason: "refusal" }, { stop_reason: "max_tokens" }, { content: [{ type: "text", text: "not json" }] }]) {
      const { res } = await run(() => claudeAnswer(over));
      expect(res.status, JSON.stringify(over)).toBe(502);
    }
  });

  it("a Claude 429 is the poster's 'try again in a moment', and the upstream body is never echoed", async () => {
    const { res } = await run(() => new Response('{"error":{"message":"secret upstream detail"}}', { status: 429 }));
    expect(res.status).toBe(429);
    expect(await res.text()).not.toContain("secret upstream detail");
  });

  it("Claude's 'overloaded' (529) is retried in place, like a Gemini 503", async () => {
    let n = 0;
    const { res, model } = await run(() => (++n === 1 ? new Response('{"type":"error","error":{"type":"overloaded_error"}}', { status: 529 }) : claudeAnswer()));
    expect(res.status).toBe(200);
    expect(model).toHaveBeenCalledTimes(2);
  });

  it("an empty credit balance (Anthropic's 400) reaches the poster as 'AI usage limit reached' (402)", async () => {
    const { res } = await run(() => new Response('{"type":"error","error":{"type":"invalid_request_error","message":"Your credit balance is too low to access the Anthropic API."}}', { status: 400 }));
    expect(res.status).toBe(402);
    expect((await res.json()).error).toBe("AI usage limit reached.");
  });

  it("refuses what the Messages API would refuse, before paying for a call: no turns, an empty turn, or a last turn that is not the poster's", async () => {
    for (const messages of [[], [{ role: "user", content: "  " }], [...ASK, { role: "assistant", content: "Sure" }]]) {
      const { res, model } = await run(() => claudeAnswer(), messages);
      expect(res.status, JSON.stringify(messages)).toBe(400);
      expect(model).not.toHaveBeenCalled();
    }
  });

  it("no ANTHROPIC_API_KEY: a generic 500, not a crash or a leak", async () => {
    setEnv({ ANTHROPIC_API_KEY: "" });
    const { res } = await run(() => claudeAnswer());
    expect(res.status).toBe(500);
  });
});
