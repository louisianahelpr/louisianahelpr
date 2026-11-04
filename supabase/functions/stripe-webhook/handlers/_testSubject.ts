/**
 * Whether any of these people is test data by public.is_test_subject (service_role only, 20261030143141):
 * a test member, an enrolled test account or a fixture login. Alerts use it with is_seed, matching
 * 20261030150104: a row with is_seed false that belongs to a test account is still test data.
 * A failed read counts as real, and so does a missing id: a page is never hidden because it could not be read.
 */
export async function anyIsTestSubject(
  // deno-lint-ignore no-explicit-any
  supabase: any,
  ids: Array<string | null | undefined>,
  logStep: (m: string, d?: unknown) => void,
): Promise<boolean> {
  for (const id of ids) {
    if (!id) continue;
    const { data, error } = await supabase.rpc("is_test_subject", { p_user_id: id });
    if (error) {
      logStep("WARNING: is_test_subject failed; treated as real", { error: error.message });
      continue;
    }
    if (data === true) return true;
  }
  return false;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Q2725 / Q2726 / Q2732 (live alerts 11-04, root cause measured): a Stripe TEST-mode event whose metadata names a
 * job_id that is not one of our jobs (not a uuid, or no such row) is a test script's payment, never a member's. The
 * TEST-mode tax checks (ci/ workflows replaying our Stripe calls with job_id "l59-test-..." / "b109-test-...") reach
 * this webhook, and the refund notice, the hourly untold-refund sweep and the tax commit paged the owner about them.
 * Only TEST mode, and only a job_id that is present: a live event, or a test event with no job_id (a gift card, a
 * Declutter order) or a real test job, is handled exactly as before. A failed read counts as ours (never hidden).
 */
export async function isTestModeOrphan(
  // deno-lint-ignore no-explicit-any
  supabase: any,
  livemode: boolean | null | undefined,
  jobId: string | null | undefined,
  logStep: (m: string, d?: unknown) => void,
): Promise<boolean> {
  if (livemode !== false || !jobId) return false;
  if (!UUID_RE.test(jobId)) return true;
  const { data, error } = await supabase.from("jobs").select("id").eq("id", jobId).maybeSingle();
  if (error) {
    logStep("WARNING: test-mode job read failed; treated as ours", { error: error.message });
    return false;
  }
  return !data;
}
