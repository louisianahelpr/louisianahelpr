import { supabase } from "@/integrations/supabase/client";
import { report } from "@/lib/errorLogger";
import type { Json } from "@/integrations/supabase/types";

/**
 * Write one admin_audit_log row (who = the signed-in admin, what = `action`,
 * target, when = the table default, reason = `details.reason`).
 *
 * Client-side ONLY for actions that are client-only (a direct table write under
 * an admin RLS policy). An action that runs through an RPC or edge function
 * writes its row at the server instead (Q76; guarded by
 * src/test/adminActionsAreAudited.test.ts).
 *
 * Never throws — the action it records has already happened, and a failed
 * audit write must not report the action as failed — but never silent either:
 * a transport error AND a zero-row insert (an RLS refusal returns
 * `{ data: [], error: null }`) are both reported. Resolves to whether the row
 * was written.
 */
export const logAdminAction = async (
  action: string,
  targetType?: string,
  targetId?: string,
  details?: Json
): Promise<boolean> => {
  try {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return false;

    const { data, error } = await supabase
      .from("admin_audit_log")
      .insert({
        admin_id: user.id,
        action,
        target_type: targetType,
        target_id: targetId,
        details,
      })
      .select("id");
    if (error) {
      report(error, { tags: { source: "logAdminAction.insert" }, context: { action, targetType, targetId } });
      return false;
    }
    if (!data || data.length === 0) {
      report(new Error(`admin_audit_log insert for ${action} affected 0 rows`), {
        tags: { source: "logAdminAction.zeroRows" },
        context: { action, targetType, targetId },
      });
      return false;
    }
    return true;
  } catch (e) {
    report(e, { tags: { source: "logAdminAction" } });
    return false;
  }
};
