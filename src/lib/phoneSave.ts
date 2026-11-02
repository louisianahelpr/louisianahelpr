import { supabase } from "@/integrations/supabase/client";
import { PHONE_IN_USE_MESSAGE } from "@/lib/mutationResult";
import { rpcErrorMessage } from "@/lib/lifecycleErrors";

/**
 * THE ONE WAY THE APP SAVES A MEMBER'S PHONE (Q1586(a), owner 2026-10-13).
 *
 * save_my_phone (20261102082018) writes profiles.phone for the caller through
 * the same triggers as before (the duplicate-number refusal, the ban-evasion
 * flag, the retained-ban auto-ban), records each judged attempt, and answers a
 * refusal instead of raising it, so the attempt is counted: 5 "already on
 * another account" answers a day and 20 saves an hour, then 'rate_limited'.
 * The direct profiles.phone write is revoked from members in the same
 * migration, so every screen that saves a phone calls this and never puts
 * `phone` in a profiles UPDATE.
 *
 * Resolves { ok: true } or { ok: false, message } for a refusal the member can
 * act on; throws on anything else (network, a server error), which the caller
 * reports like any other failed save.
 *
 * No direct-write fallback: 20261102082018 and 20261102092917 are live on prod
 * (write-contract snapshot 11-02), so a profiles.phone UPDATE is refused there.
 * `_userId` stays in the signature for the callers; the RPC reads auth.uid().
 */
const PHONE_SAVE_COPY: Record<string, string> = {
  phone_in_use: PHONE_IN_USE_MESSAGE,
  phone_invalid: "Enter a 10-digit phone number.",
  rate_limited: "That's a lot of tries with phone numbers. Try again tomorrow, or contact support.",
};

export type PhoneSaveResult = { ok: true } | { ok: false; reason: string; message: string };

export async function saveMyPhone(_userId: string, phone: string): Promise<PhoneSaveResult> {
  const { data, error } = await supabase.rpc("save_my_phone", { p_phone: phone });
  if (error) {
    // The RPC's own refusals, in words (a restricted account, a lost session).
    const copy = rpcErrorMessage("save_my_phone", error);
    if (copy) return { ok: false, reason: "refused", message: copy };
    throw error;
  }
  const answer = (data ?? {}) as { ok?: boolean; reason?: string };
  if (answer.ok === true) return { ok: true };
  const reason = typeof answer.reason === "string" ? answer.reason : "unknown";
  return { ok: false, reason, message: PHONE_SAVE_COPY[reason] ?? "We couldn't save your phone number. Try again." };
}
