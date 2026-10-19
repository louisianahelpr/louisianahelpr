/**
 * SH12 shop FAQs (migration 20261019072541_shops_faqs.sql): up to 10
 * question + answer pairs on a shop's page, written by its owner. The server
 * checks every rule (owner only, lengths, no phone numbers, emails or links);
 * the limits here only shape the form.
 */
import { supabase } from "@/integrations/supabase/client";
import { rpcErrorMessage } from "./rpcErrorCopy";
import { cancelPolicyText, ORDER_HOLD_TEXT, type CancelPolicy, type ReadyTapCancel } from "./orders";

export interface ShopFaq {
  question: string;
  answer: string;
}

export const FAQ_MAX = 10;
export const FAQ_QUESTION_MAX = 140;
export const FAQ_ANSWER_MAX = 600;

/** The RPC's error with its plain-words copy (read at each call site) as userMessage. */
function rpcFail(error: { message: string }, words: string | null | undefined): never {
  throw Object.assign(new Error(error.message), error, words ? { userMessage: words } : {});
}

/**
 * The FAQs a viewer may see: [] when the shop has none, and also [] when the
 * function is not deployed yet (PGRST202: migrations land on merge) or the
 * shop is not visible (NULL), so the page simply shows no FAQ card.
 */
export async function fetchShopFaqs(shopId: string): Promise<ShopFaq[]> {
  const { data, error } = await supabase.rpc("shops_shop_faqs", { p_shop_id: shopId });
  if ((error as { code?: string } | null)?.code === "PGRST202") return [];
  if (error) rpcFail(error, rpcErrorMessage("shops_shop_faqs", error));
  return Array.isArray(data) ? (data as unknown as ShopFaq[]) : [];
}

/** Replace the caller's own shop's FAQs; blank rows are dropped first. Returns how many were saved. */
export async function saveMyShopFaqs(faqs: ShopFaq[]): Promise<number> {
  const rows = faqs
    .map((f) => ({ question: f.question.trim(), answer: f.answer.trim() }))
    .filter((f) => f.question !== "" || f.answer !== "");
  const { data, error } = await supabase.rpc("shops_set_my_faqs", { p_faqs: rows });
  if (error) rpcFail(error, rpcErrorMessage("shops_set_my_faqs", error));
  // The count is the proof of the write: no number means nothing we can trust was saved.
  if (typeof data !== "number") throw Object.assign(new Error("faqs_not_saved"), { userMessage: "Your questions didn't save. Try again." });
  return data;
}

/** SH12 "Shop policies": the two rules a buyer reads before paying (shops_shop_policies, same visibility as FAQs). */
export interface ShopPolicies {
  cancel_policy: CancelPolicy;
  ready_tap_cancel: ReadyTapCancel;
}

/** null when the shop isn't visible, or the function isn't deployed yet (PGRST202): no card. */
export async function fetchShopPolicies(shopId: string): Promise<ShopPolicies | null> {
  const { data, error } = await supabase.rpc("shops_shop_policies", { p_shop_id: shopId });
  if ((error as { code?: string } | null)?.code === "PGRST202") return null;
  if (error) rpcFail(error, rpcErrorMessage("shops_shop_policies", error));
  return (data as unknown as ShopPolicies | null) ?? null;
}

/** One short line each, in the order sheet's own words (cancelPolicyText, ORDER_HOLD_TEXT): never a second copy. */
export function shopPolicyLines(p: ShopPolicies): { key: "cancel" | "payment"; label: string; text: string }[] {
  return [
    { key: "cancel", label: "Cancelling", text: cancelPolicyText(p.cancel_policy, p.ready_tap_cancel).label },
    { key: "payment", label: "Paying", text: ORDER_HOLD_TEXT },
  ];
}
