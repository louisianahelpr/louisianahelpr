/**
 * Server-side enforcement of a hidden feature switch, for edge functions.
 *
 * The client hook (`useFeature`) only hides a control; anyone can call the
 * function behind it directly. An edge function behind a hidden feature asks
 * the SAME decision the app does, for its VERIFIED caller, before doing any
 * work:
 *
 *   const { data: { user } } = await anonClient.auth.getUser(jwt);  // as today
 *   const refused = await requireFeature(serviceClient, "my_feature", user?.id, corsHeaders);
 *   if (refused) return refused;
 *
 * `serviceClient` must be the service-role client: the decision function
 * `public.feature_enabled_for_user(key, user_id)` is granted to service_role
 * only (a client must never learn who is a tester). Pass the user id from the
 * verified JWT, never one from the request body.
 *
 * FAIL CLOSED: a missing user, an RPC error, a missing switch or any answer
 * other than `true` refuses with 403 { error: "feature_disabled" }.
 *
 * SQL RPCs behind a hidden feature use `PERFORM public.require_feature('<key>');`
 * as their first statement instead (migration 20261012031120).
 */

/** The one call this needs from a supabase-js client. */
export interface FeatureSwitchClient {
  rpc(
    fn: "feature_enabled_for_user",
    args: { p_key: string; p_user_id: string },
  ): PromiseLike<{ data: unknown; error: { message: string } | null }>;
}

/** True only when the server answered exactly `true` for this user. */
export async function featureEnabledForUser(
  client: FeatureSwitchClient,
  key: string,
  userId: string | null | undefined,
): Promise<boolean> {
  if (!userId) return false;
  try {
    const { data, error } = await client.rpc("feature_enabled_for_user", { p_key: key, p_user_id: userId });
    if (error) {
      console.error(`[featureSwitch] feature_enabled_for_user(${key}) failed: ${error.message}`);
      return false;
    }
    return data === true;
  } catch (err) {
    // Fail closed: a transport failure is "off", logged so it is not silent.
    console.error(`[featureSwitch] feature_enabled_for_user(${key}) threw: ${err instanceof Error ? err.message : String(err)}`);
    return false;
  }
}

/** null when the caller may proceed; a 403 Response to return otherwise. */
export async function requireFeature(
  client: FeatureSwitchClient,
  key: string,
  userId: string | null | undefined,
  headers: Record<string, string> = {},
): Promise<Response | null> {
  if (await featureEnabledForUser(client, key, userId)) return null;
  return new Response(JSON.stringify({ error: "feature_disabled" }), {
    status: 403,
    headers: { ...headers, "Content-Type": "application/json" },
  });
}
