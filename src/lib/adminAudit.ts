import { supabase } from "@/integrations/supabase/client";

export const logAdminAction = async (
  action: string,
  targetType?: string,
  targetId?: string,
  details?: Record<string, unknown>
) => {
  try {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;

    await (supabase.from as any)("admin_audit_log").insert({
      admin_id: user.id,
      action,
      target_type: targetType,
      target_id: targetId,
      details,
    });
  } catch (e) {
    console.error("Audit log failed:", e);
  }
};
