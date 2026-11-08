import { useEffect } from "react";
import type { User as SupaUser } from "@supabase/supabase-js";
import { useNeedsYouTodos } from "@/pages/home/homeDashboard/useNeedsYouTodos";
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
  // My Jobs' rows (owner 11-08): a Jobs to-do is about a job I posted (id "p-") or one I'm working (id "a-", needsYouTodos).
  const jobsPosted = todos.filter((t) => t.section === "jobs" && t.id.startsWith("p-")).length;
  const jobsWorking = jobs - jobsPosted;
  const shops = todos.filter((t) => t.section === "shops").length;
  const declutter = todos.filter((t) => t.section === "declutter").length;
  useEffect(() => {
    // Nothing read yet: publish nothing, rather than a "0" that is not a fact.
    if (loading) return;
    publishNeedsYou(uid, { total: jobs + shops + declutter, jobs, shops, declutter, jobsPosted, jobsWorking });
  }, [uid, loading, jobs, shops, declutter, jobsPosted, jobsWorking]);
  useEffect(() => () => clearNeedsYou(), [uid]);
  return null;
}
