import { supabase } from "@/integrations/supabase/client";
import { report } from "@/lib/errorLogger";
import type { Json } from "@/integrations/supabase/types";

export const logAdminAction = async (
  action: string,
  targetType?: string,
  targetId?: string,
  details?: Json
) => {
  try {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;

    // supabase-js resolves errors into `{ error }` rather than throwing, so the
    // surrounding try/catch never sees an insert failure — read it explicitly
    // so a lost compliance/traceability record still gets logged.
    const { error } = await supabase.from("admin_audit_log").insert({
      admin_id: user.id,
      action,
      target_type: targetType,
      target_id: targetId,
      details,
    });
    if (error) report(error, { tags: { source: "logAdminAction.insert" } });
  } catch (e) {
    report(e, { tags: { source: "logAdminAction" } });
  }
};
