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

    await supabase.from("admin_audit_log").insert({
      admin_id: user.id,
      action,
      target_type: targetType,
      target_id: targetId,
      details,
    });
  } catch (e) {
    report(e, { tags: { source: "logAdminAction" } });
  }
};
