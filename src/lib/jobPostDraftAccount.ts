/**
 * A half-finished job post kept on the account too (OPS-3), so the one reminder has something to remind about and another
 * device can pick it up. The device's own copy (useDraftJob) stays the first choice and these never hold up typing: a
 * failure here is logged, and the device still has the draft.
 */
import { supabase } from "@/integrations/supabase/client";
import type { Json } from "@/integrations/supabase/types";

/** Long enough for a normal read, short enough that Post a job never waits on a bad connection. */
const READ_TIMEOUT_MS = 1500;

async function signedIn(): Promise<boolean> {
  const { data } = await supabase.auth.getSession();
  return !!data.session;
}

export async function saveDraftToAccount(draft: object): Promise<void> {
  try {
    if (!(await signedIn())) return;
    const { error } = await supabase.rpc("save_my_job_post_draft", { p_draft: draft as Json });
    if (error) console.warn("[post-job] draft not kept on the account", error.message);
  } catch (err) {
    console.warn("[post-job] draft not kept on the account", err);
  }
}

export async function clearDraftOnAccount(): Promise<void> {
  try {
    if (!(await signedIn())) return;
    const { error } = await supabase.rpc("clear_my_job_post_draft");
    if (error) console.warn("[post-job] draft not cleared on the account", error.message);
  } catch (err) {
    console.warn("[post-job] draft not cleared on the account", err);
  }
}

/** The account's draft, or null: none, too old, a job made since, signed out, or no answer in time. */
export async function readDraftFromAccount<T>(): Promise<T | null> {
  const read = (async () => {
    if (!(await signedIn())) return null;
    const { data, error } = await supabase.rpc("my_job_post_draft");
    if (error) throw new Error(error.message);
    return (data as T | null) ?? null;
  })();
  try {
    return await Promise.race([read, new Promise<null>((done) => setTimeout(() => done(null), READ_TIMEOUT_MS))]);
  } catch (err) {
    console.warn("[post-job] could not read the account's draft", err);
    return null;
  }
}
