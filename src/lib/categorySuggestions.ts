/**
 * "Suggest a category" (owner decision I1, 2026-10-14): the client half of
 * migration 20261015051141. Every refusal the server raises has plain words in
 * RPC_ERROR_COPY (src/lib/lifecycleErrors.ts); these helpers throw an Error
 * carrying them on `userMessage`, the original kept for reporting.
 *
 * Behind the hidden switch `suggest_category`: the server refuses everyone the
 * switch does not reach (require_feature), whatever the client shows.
 */
import { supabase } from "@/integrations/supabase/client";
import { unwrap } from "@/lib/supabaseResult";
import { loadAdminRpcErrorCopy, rpcErrorMessage } from "@/lib/lifecycleErrors";

export type SuggestionArea = "jobs" | "declutter";
export type SuggestionStatus = "pending" | "approved" | "declined";

export interface CategorySuggestionRow {
  id: string;
  area: SuggestionArea;
  suggestion: string;
  status: SuggestionStatus;
  created_at: string;
  suggester_name: string | null;
  same_count: number;
  reviewed_at: string | null;
  admin_note: string | null;
}

/** The same bounds suggest_category() enforces, so the form can say so first. */
const SUGGESTION_MIN = 2;
export const SUGGESTION_MAX = 40;
const SUGGESTION_SHAPE = /^[A-Za-z][A-Za-z0-9 &/'(),.-]*$/;

/** Plain-words problem with a draft suggestion, or null when the server would take it. */
export function suggestionProblem(raw: string): string | null {
  const text = raw.trim().replace(/\s+/g, " ");
  if (text.length < SUGGESTION_MIN) return "Type at least 2 letters.";
  if (text.length > SUGGESTION_MAX) return `Keep it under ${SUGGESTION_MAX + 1} characters.`;
  // The same three refusals suggest_category() makes: the shape, a phone-number
  // run, a "word.tld" link.
  if (!SUGGESTION_SHAPE.test(text) || /[0-9][0-9 ().-]{5,}[0-9]/.test(text) || /[a-z0-9-]\.[a-z]{2,}/i.test(text)) {
    return "Start with a letter. No links or contact details.";
  }
  return null;
}

function rpcResult<T>(result: { data: T; error: { message: string } | null }, words: (e: unknown) => string | null): T {
  if (!result.error) return result.data;
  try {
    unwrap(result);
  } catch (thrown) {
    const e = thrown as Error & { userMessage?: string };
    const msg = words(thrown);
    if (msg && Object.isExtensible(e)) e.userMessage = msg;
    throw e;
  }
  return result.data;
}

export async function suggestCategory(area: SuggestionArea, suggestion: string): Promise<string> {
  const res = await supabase.rpc("suggest_category", { p_area: area, p_suggestion: suggestion.trim() });
  // Never null on success: suggest_category returns the row id or raises.
  return rpcResult(res, (e) => rpcErrorMessage("suggest_category", e)) as string;
}

export async function fetchCategorySuggestions(status: SuggestionStatus): Promise<CategorySuggestionRow[]> {
  const res = await supabase.rpc("admin_list_category_suggestions", { p_status: status });
  // Admin-only copy is fetched only on a refusal (lifecycleErrors.ts, loadAdminRpcErrorCopy).
  const admin = res.error ? await loadAdminRpcErrorCopy() : null;
  return (rpcResult(res, (e) => admin?.rpcErrorMessage("admin_list_category_suggestions", e) ?? null) ?? []) as CategorySuggestionRow[];
}

export async function reviewCategorySuggestion(id: string, approve: boolean, note: string | null): Promise<number> {
  const res = await supabase.rpc("admin_review_category_suggestion", {
    p_id: id,
    p_approve: approve,
    p_note: note?.trim() || undefined,
  });
  const admin = res.error ? await loadAdminRpcErrorCopy() : null;
  // Never null on success: the review returns the count it resolved or raises.
  return rpcResult(res, (e) => admin?.rpcErrorMessage("admin_review_category_suggestion", e) ?? null) as number;
}

/** The words to show for any error these helpers threw. */
export function suggestionErrorMessage(err: unknown): string {
  const m = (err as { userMessage?: unknown } | null)?.userMessage;
  return typeof m === "string" && m ? m : "Couldn't do that just now. Check your connection and try again.";
}
