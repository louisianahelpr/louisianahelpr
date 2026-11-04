import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { report } from "@/lib/errorLogger";
import type { Notification } from "./types";

export type NotificationFace = { name: string | null; avatarUrl: string | null };

/**
 * Q2037 faces: the person who caused each job notice (notifications.actor_id, 20261104060659), read through
 * get_safe_profiles (masked "First L." name + photo, the same source the job cards use). A notice with no actor,
 * or whose actor is no longer readable, keeps its type icon. A failed read is reported and the icons stay.
 */
export function useNotificationFaces(notifications: Notification[]): Map<string, NotificationFace> {
  const key = [...new Set(notifications.map((n) => n.actor_id).filter((id): id is string => !!id))].sort().join(",");
  const [faces, setFaces] = useState<Map<string, NotificationFace>>(() => new Map());
  useEffect(() => {
    if (!key) return;
    let live = true;
    void (async () => {
      const { data, error } = await supabase.rpc("get_safe_profiles", { user_ids: key.split(",") });
      if (!live) return;
      if (error) {
        report(error, { severity: "warning", tags: { source: "NotificationPanel.faces" } });
        return;
      }
      const next = new Map<string, NotificationFace>();
      for (const p of data ?? []) next.set(p.user_id, { name: p.full_name ?? null, avatarUrl: p.avatar_url ?? null });
      setFaces(next);
    })().catch((e: unknown) => report(e, { severity: "warning", tags: { source: "NotificationPanel.faces" } }));
    return () => {
      live = false;
    };
  }, [key]);
  return faces;
}
