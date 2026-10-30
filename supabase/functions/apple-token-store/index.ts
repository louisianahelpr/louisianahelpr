// Keep the signed-in member's Sign in with Apple refresh token (Q1791).
//
// Called by src/lib/socialAuth.ts right after an Apple sign-in succeeds, with
// the one-time authorization code Apple gave the device. The code is exchanged
// with Apple here, server side, and the refresh token is stored in
// public.apple_sign_in_tokens so account deletion can revoke it
// (_shared/appleSignIn.ts, App Store Review 5.1.1(v)).
//
// Never blocks sign-in: the client fires and forgets. Answers:
//   200 { stored: true }                       kept
//   200 { stored: false, reason }              not_configured / apple_refused /
//                                              no_refresh_token / network
//   400 bad_request                            missing code / unknown client
//   401                                        no or bad session
//   403 not_apple                              the session has no Apple identity
//   403 { stored: false, identity_mismatch }   Apple's id_token for the code
//                                              names a different Apple account
// Tokens, codes and the client secret are never logged or echoed.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { serve } from "../_shared/buildStamp.ts";
import { corsHeadersFull as corsHeaders, jsonResponse, errorResponse } from "../_shared/cors.ts";
import { checkRateLimit, rateLimitResponse } from "../_shared/rate-limit.ts";
import { appleSignInKeyFromEnv, callerAppleSubs, exchangeAppleCode, isAppleClientId } from "../_shared/appleSignIn.ts";

serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return errorResponse("method_not_allowed", 405, corsHeaders);

  const rl = await checkRateLimit(req, { windowMs: 300_000, maxRequests: 10, keyPrefix: "apple-token-store" });
  if (!rl.allowed) return rateLimitResponse(rl.retryAfter ?? 300, corsHeaders);

  const authHeader = req.headers.get("Authorization");
  if (!authHeader) return errorResponse("Missing authorization", 401, corsHeaders);

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const anon = createClient(supabaseUrl, Deno.env.get("SUPABASE_ANON_KEY")!, {
    global: { headers: { Authorization: authHeader } },
  });
  const { data: userRes, error: userErr } = await anon.auth.getUser();
  const user = userRes?.user;
  if (userErr || !user) return errorResponse("Not authenticated", 401, corsHeaders);
  // The caller's own Apple user ids. The code exchanged below must belong to
  // one of them (Apple's id_token sub), or nothing is stored.
  const appleSubs = callerAppleSubs(user.identities);
  if (appleSubs.length === 0) return errorResponse("not_apple", 403, corsHeaders);

  // Only a code is accepted, never a token from the client: the refresh token
  // stored is always one Apple itself issued to us for this exchange.
  const body = await req.json().catch(() => null) as { authorizationCode?: unknown; clientId?: unknown } | null;
  const clientId = body?.clientId;
  if (!isAppleClientId(clientId)) return errorResponse("bad_request", 400, corsHeaders);
  const code = typeof body?.authorizationCode === "string" ? body.authorizationCode.trim() : "";
  if (!code || code.length > 4096) return errorResponse("bad_request", 400, corsHeaders);

  const ex = await exchangeAppleCode(appleSignInKeyFromEnv((n) => Deno.env.get(n)), clientId, code, appleSubs);
  if (!ex.ok && ex.reason === "identity_mismatch") {
    console.error(`apple-token-store: refused for ${user.id}: the code belongs to a different Apple account`);
    return jsonResponse({ stored: false, reason: ex.reason }, 403, corsHeaders);
  }
  if (!ex.ok) {
    console.error(`apple-token-store: not stored for ${user.id}: ${ex.reason}${ex.status ? ` (${ex.status})` : ""}`);
    return jsonResponse({ stored: false, reason: ex.reason }, 200, corsHeaders);
  }
  const refreshToken = ex.refreshToken;

  const admin = createClient(supabaseUrl, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const { data: rows, error } = await admin
    .from("apple_sign_in_tokens")
    .upsert(
      { user_id: user.id, refresh_token: refreshToken, client_id: clientId, updated_at: new Date().toISOString() },
      { onConflict: "user_id" },
    )
    .select("user_id");
  if (error || !rows?.length) {
    console.error(`apple-token-store: upsert failed for ${user.id}: ${error?.message ?? "0 rows"}`);
    return errorResponse("store_failed", 500, corsHeaders);
  }
  return jsonResponse({ stored: true }, 200, corsHeaders);
});
