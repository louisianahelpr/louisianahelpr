/**
 * "Suggested reply" and "Lowest you'll take" (aiReply.ts): the error words a seller reads and the answers the screens
 * can trust. A bad answer from the model must read as unavailable rather than filling the box, and the HTTP status has
 * to survive the call for the read-retry policy (Q1182) to tell a refusal from a failing server.
 *
 * @mutate src/lib/declutter/aiReply.ts |   return REPLY_ERROR_COPY[code] ?? REPLY_ERROR_COPY.ai_unavailable; |   return REPLY_ERROR_COPY[code] ?? code;
 * @mutate src/lib/declutter/aiReply.ts | { body: { questionId }, timeout: REPLY_TIMEOUT_MS } | { body: { questionId } }
 * @mutate src/lib/declutter/aiReply.ts |  !d.reply.trim() |  false
 * @mutate src/lib/declutter/aiReply.ts | needsSeller: d.needsSeller === true | needsSeller: !!d.needsSeller
 * @mutate src/lib/declutter/aiReply.ts |   if (aborted) return new Error("ai_timed_out"); |   if (false) return new Error("ai_timed_out");
 * @mutate src/lib/declutter/aiReply.ts | status === 429 ? "rate_limited" : "" | ""
 * @mutate src/lib/declutter/aiReply.ts | status > 0 ? { status } : {} | {}
 * @mutate src/lib/declutter/aiReply.ts | ...(priceCents === undefined ? {} : { priceCents }) | priceCents
 * @mutate src/lib/declutter/aiReply.ts |  !Number.isInteger(d.floorCents) |  false
 * @mutate src/lib/declutter/aiReply.ts | d.floorCents < 100 | d.floorCents < 0
 * @mutate src/lib/declutter/aiReply.ts | reason: typeof d.reason === "string" ? d.reason : "" | reason: d.reason as string
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: { functions: { invoke: h.invoke } } }));

import { requestSuggestedFloor, requestSuggestedReply, suggestedReplyErrorMessage } from "./aiReply";

const httpError = (status: number, body: string) => ({ name: "FunctionsHttpError", context: new Response(body, { status }) });

beforeEach(() => { h.invoke.mockReset(); });
afterEach(() => { vi.restoreAllMocks(); });

describe("suggestedReplyErrorMessage", () => {
  it("each known code has its own words", () => {
    expect(suggestedReplyErrorMessage(new Error("rate_limited"))).toMatch(/Too many suggestions/);
    expect(suggestedReplyErrorMessage(new Error("under_18"))).toMatch(/18 or older/);
  });

  it("anything else reads as unavailable, never as a raw code", () => {
    const unavailable = suggestedReplyErrorMessage(new Error("ai_unavailable"));
    expect(suggestedReplyErrorMessage(new Error("some_server_code"))).toBe(unavailable);
    expect(suggestedReplyErrorMessage("not an error")).toBe(unavailable);
  });
});

describe("requestSuggestedReply", () => {
  it("asks for this question with the app's own time limit", async () => {
    h.invoke.mockResolvedValue({ data: { reply: "It's blue.", needsSeller: true }, error: null });
    await expect(requestSuggestedReply("q1")).resolves.toEqual({ reply: "It's blue.", needsSeller: true });
    expect(h.invoke).toHaveBeenCalledWith("declutter-ai-reply", { body: { questionId: "q1" }, timeout: 60_000 });
  });

  it("only a literal true asks the seller to fill a blank", async () => {
    h.invoke.mockResolvedValue({ data: { reply: "It's blue.", needsSeller: "false" }, error: null });
    await expect(requestSuggestedReply("q1")).resolves.toEqual({ reply: "It's blue.", needsSeller: false });
  });

  it.each([
    ["no answer", null],
    ["no reply", {}],
    ["a reply that isn't words", { reply: 7 }],
    ["a blank reply", { reply: "   " }],
  ])("%s is unavailable, not an empty box", async (_name, data) => {
    h.invoke.mockResolvedValue({ data, error: null });
    await expect(requestSuggestedReply("q1")).rejects.toThrow("ai_unavailable");
  });

  it("a call that was cut off reads as timed out, on the error or on its context", async () => {
    h.invoke.mockResolvedValue({ data: null, error: { name: "AbortError" } });
    await expect(requestSuggestedReply("q1")).rejects.toThrow("ai_timed_out");
    h.invoke.mockResolvedValue({ data: null, error: { name: "FunctionsFetchError", context: { name: "AbortError" } } });
    await expect(requestSuggestedReply("q1")).rejects.toThrow("ai_timed_out");
  });

  it("the function's own code is the error, and its status rides along", async () => {
    h.invoke.mockResolvedValue({ data: null, error: httpError(404, JSON.stringify({ error: "question_not_found" })) });
    await expect(requestSuggestedReply("q1")).rejects.toMatchObject({ message: "question_not_found", status: 404 });
  });

  it("a 429 whose body is not JSON is still rate limited, and says what happened", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    h.invoke.mockResolvedValue({ data: null, error: httpError(429, "<html>slow down</html>") });
    await expect(requestSuggestedReply("q1")).rejects.toMatchObject({ message: "rate_limited", status: 429 });
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it("a server failure with no usable code is unavailable, with its status", async () => {
    h.invoke.mockResolvedValue({ data: null, error: httpError(503, JSON.stringify({ error: 42 })) });
    await expect(requestSuggestedReply("q1")).rejects.toMatchObject({ message: "ai_unavailable", status: 503 });
  });

  it("a failure with no response at all is unavailable, with no made-up status", async () => {
    h.invoke.mockResolvedValue({ data: null, error: { name: "FunctionsFetchError", message: "network down" } });
    const err = await requestSuggestedReply("q1").catch((e: unknown) => e) as Error & { status?: number };
    expect(err.message).toBe("ai_unavailable");
    expect(err).not.toHaveProperty("status");
  });
});

describe("requestSuggestedFloor", () => {
  it("sends the price only when there is one", async () => {
    h.invoke.mockResolvedValue({ data: { floorCents: 500, reason: "Priced to sell" }, error: null });
    await expect(requestSuggestedFloor("i1", 800)).resolves.toEqual({ floorCents: 500, reason: "Priced to sell" });
    expect(h.invoke.mock.calls[0][1].body).toStrictEqual({ mode: "floor", itemId: "i1", priceCents: 800 });
    await requestSuggestedFloor("i1");
    expect(h.invoke.mock.calls[1][1].body).toStrictEqual({ mode: "floor", itemId: "i1" });
    expect(h.invoke.mock.calls[1][1].timeout).toBe(60_000);
  });

  it("a reason that isn't words is left blank", async () => {
    h.invoke.mockResolvedValue({ data: { floorCents: 500, reason: 9 }, error: null });
    await expect(requestSuggestedFloor("i1")).resolves.toEqual({ floorCents: 500, reason: "" });
  });

  it("the lowest allowed floor is one dollar", async () => {
    h.invoke.mockResolvedValue({ data: { floorCents: 100 }, error: null });
    await expect(requestSuggestedFloor("i1")).resolves.toMatchObject({ floorCents: 100 });
  });

  it.each([
    ["no answer", null],
    ["a floor in text", { floorCents: "500" }],
    ["part of a cent", { floorCents: 500.5 }],
    ["under a dollar", { floorCents: 99 }],
  ])("%s never fills the seller's box", async (_name, data) => {
    h.invoke.mockResolvedValue({ data, error: null });
    await expect(requestSuggestedFloor("i1")).rejects.toThrow("ai_unavailable");
  });

  it("a failed call throws its code like the reply does", async () => {
    h.invoke.mockResolvedValue({ data: null, error: httpError(403, JSON.stringify({ error: "account_restricted" })) });
    await expect(requestSuggestedFloor("i1")).rejects.toMatchObject({ message: "account_restricted", status: 403 });
  });
});
