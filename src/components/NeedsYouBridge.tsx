import { useEffect } from "react";
import type { User as SupaUser } from "@supabase/supabase-js";
import { useNeedsYouTodos } from "@/pages/home/homeDashboard/needsYouTodos";
import { clearNeedsYou, publishNeedsYou } from "@/lib/needsYouStore";

/**
 * Runs Home's to-do list once for the signed-in member and publishes its
 * counts to needsYouStore, which the navs read (badge = To-do, owner
 * 2026-10-20). App.tsx lazy-loads this and mounts it only with a user, so the
 * activity reads never reach the first-screen chunk (src/test/bootReach.test.ts)
 * and a signed-out visitor pays for none of them.
 */
export default function NeedsYouBridge({ user }: { user: SupaUser }) {
  const { todos, loading } = useNeedsYouTodos(user, { live: true });
  const uid = user.id;
  const jobs = todos.filter((t) => t.section === "jobs").length;
  const shops = todos.filter((t) => t.section === "shops").length;
  useEffect(() => {
    // Nothing read yet: publish nothing, rather than a "0" that is not a fact.
    if (loading) return;
    publishNeedsYou(uid, { total: jobs + shops, jobs, shops });
  }, [uid, loading, jobs, shops]);
  useEffect(() => () => clearNeedsYou(), [uid]);
  return null;
}
