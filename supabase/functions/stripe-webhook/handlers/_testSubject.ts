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
