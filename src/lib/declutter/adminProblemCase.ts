/**
 * The admin's dispute screen reads for one reported Declutter problem (owner 2026-10-28 anti-lying measures AL-4
 * and AL-6): the chat and item questions (declutter_admin_problem_talk) and the order's own step facts and Helpr
 * photos (declutter_admin_problem_case). Both are admin-only (has_role admin first) and carry no names, ids or
 * addresses: who wrote a message is a side ('buyer', 'seller', 'another_member').
 */
import { supabase } from "@/integrations/supabase/client";
import { loadAdminRpcErrorCopy } from "@/lib/lifecycleErrors";
import { isMissingRpcNamed } from "@/lib/missingRpc";
import { rpcData } from "@/lib/declutter/api";

export interface ProblemTalkRow {
  kind: "chat" | "question";
  side: "buyer" | "seller" | "another_member";
  body: string;
  said_at: string;
  answer: string | null;
  answered_at: string | null;
  removed: boolean;
}

/** The chat and the questions for one problem, oldest first. Null before the read is on the server (PGRST202). */
export async function fetchProblemTalk(problemId: string): Promise<ProblemTalkRow[] | null> {
  const res = await supabase.rpc("declutter_admin_problem_talk", { p_problem_id: problemId });
  if (res.error && isMissingRpcNamed(res.error, "declutter_admin_problem_talk")) return null;
  const admin = res.error ? await loadAdminRpcErrorCopy() : null;
  return (rpcData(res, (e) => admin?.rpcErrorMessage("declutter_admin_problem_talk", e) ?? null) ?? []) as ProblemTalkRow[];
}
