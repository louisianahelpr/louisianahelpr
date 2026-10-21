import { supabase } from "@/integrations/supabase/client";
import { PHONE_IN_USE_MESSAGE, phoneInUseMessage, unwrapMutation } from "@/lib/mutationResult";
import { rpcErrorMessage } from "@/lib/lifecycleErrors";

/**
 * THE ONE WAY THE APP SAVES A MEMBER'S PHONE (Q1586(a), owner 2026-10-13).
 *
 * save_my_phone (20261013012700) writes profiles.phone for the caller through
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
 */
const PHONE_SAVE_COPY: Record<string, string> = {
  phone_in_use: PHONE_IN_USE_MESSAGE,
  phone_invalid: "Enter a 10-digit phone number.",
  rate_limited: "That's a lot of tries with phone numbers. Try again tomorrow, or contact support.",
};

export type PhoneSaveResult = { ok: true } | { ok: false; reason: string; message: string };

export async function saveMyPhone(userId: string, phone: string): Promise<PhoneSaveResult> {
  const { data, error } = await supabase.rpc("save_my_phone", { p_phone: phone });
  if (error) {
    // The RPC ships in the migration that revokes the direct write; until that
    // migration is live the direct write is still the way (a new bundle ahead
    // of db-deploy).
    if ((error as { code?: string }).code === "PGRST202") {
      const res = await supabase.from("profiles").update({ phone: phone.trim() || null }).eq("user_id", userId).select("id");
      // Before the RPC, the database's duplicate refusal arrives as an error.
      const inUse = phoneInUseMessage(res.error);
      if (inUse) return { ok: false, reason: "phone_in_use", message: inUse };
      unwrapMutation(res, { action: "save your phone number", context: { userId } });
      return { ok: true };
    }
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
