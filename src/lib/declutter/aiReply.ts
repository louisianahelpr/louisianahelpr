/**
 * "Suggested reply" (owner 2026-10-29, builder 26 feature 1): Claude drafts the seller's answer to a buyer's question
 * from the listing's words and photos (edge function declutter-ai-reply). The seller posts it or edits it; nothing is
 * posted or stored by this call. Only the answer the seller sends is saved (declutter_answer_question).
 */
import { supabase } from "@/integrations/supabase/client";

export interface SuggestedReply {
  reply: string;
  /** The listing does not say what was asked: the reply has a ___ blank the seller fills before posting. */
  needsSeller: boolean;
}

/** The app's own bound on a hung connection: the function's model call is 25 s, plus one retry on a busy answer. */
const REPLY_TIMEOUT_MS = 60_000;

/** The edge function's error codes, in words. Anything unknown reads as unavailable. */
const REPLY_ERROR_COPY: Record<string, string> = {
  ai_unavailable: "A suggested reply isn't available right now. You can write your own.",
  ai_timed_out: "The suggestion took too long. You can write your own.",
  question_not_found: "This question was already answered or removed.",
  rate_limited: "Too many suggestions for now. Wait a few minutes, or write your own.",
  account_restricted: "Your account can't answer questions right now.",
  declutter_strikes_blocked: "Your account can't answer questions right now.",
  under_18: "You need to be 18 or older to sell on Declutter.",
  feature_disabled: "A suggested reply isn't available right now. You can write your own.",
  not_authenticated: "Sign in again to get a suggested reply.",
};

export function suggestedReplyErrorMessage(err: unknown): string {
  const code = err instanceof Error ? err.message : "";
  return REPLY_ERROR_COPY[code] ?? REPLY_ERROR_COPY.ai_unavailable;
}

/** The suggestion for one unanswered question on the caller's own listing. Throws Error(<code>). */
export async function requestSuggestedReply(questionId: string): Promise<SuggestedReply> {
  const { data, error } = await supabase.functions.invoke("declutter-ai-reply", { body: { questionId }, timeout: REPLY_TIMEOUT_MS });
  if (error) throw await replyFailure(error);
  const d = data as { reply?: unknown; needsSeller?: unknown } | null;
  if (!d || typeof d.reply !== "string" || !d.reply.trim()) throw new Error("ai_unavailable");
  return { reply: d.reply, needsSeller: d.needsSeller === true };
}

/**
 * The Error(<code>) a failed call throws. The code comes from the edge function's own JSON body (not a Supabase
 * result), and the HTTP status rides on the error so the read-retry policy (src/lib/queryRetry.ts) can tell a
 * refusal from a failing server (Q1182).
 */
async function replyFailure(fnError: unknown): Promise<Error & { status?: number }> {
  const aborted = (fnError as { name?: unknown }).name === "AbortError" || (fnError as { context?: { name?: unknown } }).context?.name === "AbortError";
  if (aborted) return new Error("ai_timed_out");
  const ctx = (fnError as { context?: Response }).context;
  const status = ctx && typeof ctx.status === "number" ? ctx.status : 0;
  const sent: { error?: unknown } | null = ctx && typeof ctx.json === "function"
    ? await ctx.json().catch((parseErr: unknown) => {
        // A body that is not JSON carries no code: it reads as unavailable.
        console.warn("[declutter] suggested reply error body was not JSON", parseErr);
        return null;
      })
    : null;
  const code = typeof sent?.error === "string" ? sent.error : status === 429 ? "rate_limited" : "";
  return Object.assign(new Error(code || "ai_unavailable"), status > 0 ? { status } : {});
}

/** Smart offers (c): Claude's "Lowest you'll take" for the caller's own item (declutter-ai-reply, mode "floor"). Nothing is saved. */
export interface SuggestedFloor {
  floorCents: number;
  reason: string;
}

/** Throws Error(<code>) like requestSuggestedReply; the codes read through suggestedReplyErrorMessage's table. */
export async function requestSuggestedFloor(itemId: string, priceCents?: number): Promise<SuggestedFloor> {
  const { data, error } = await supabase.functions.invoke("declutter-ai-reply", {
    body: { mode: "floor", itemId, ...(priceCents === undefined ? {} : { priceCents }) },
    timeout: REPLY_TIMEOUT_MS,
  });
  if (error) throw await replyFailure(error);
  const d = data as { floorCents?: unknown; reason?: unknown } | null;
  if (!d || typeof d.floorCents !== "number" || !Number.isInteger(d.floorCents) || d.floorCents < 100) throw new Error("ai_unavailable");
  return { floorCents: d.floorCents, reason: typeof d.reason === "string" ? d.reason : "" };
}
