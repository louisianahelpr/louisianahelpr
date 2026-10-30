// geocode-address: turn a typed address into a point with Apple Maps, and say how precise the match was.
// Called by src/lib/addressLookup.ts, whose browser Nominatim tiers take over when this cannot answer.
//
// Lead's verdict 2026-10-30: signed-in only, rate limited, Apple Maps with the existing MapKit key, no address in
// logs or responses beyond coordinates and match precision, no database writes. The typed address goes to Apple and
// nowhere else. Logs carry the outcome and an HTTP status only, so the misses can be counted.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.99.0";
import { corsHeadersFull as corsHeaders, jsonResponse, errorResponse } from "../_shared/cors.ts";
import { checkRateLimit, rateLimitResponse } from "../_shared/rate-limit.ts";
import { serve } from "../_shared/buildStamp.ts";
import { mapkitKeyFromEnv, signMapkitJwt } from "../_shared/mapkitJwt.ts";
import { geocodeAddressPoint } from "../_shared/geocodeAddressPoint.ts";
import { refuseUnconfirmedEmail } from "../_shared/requireConfirmedEmail.ts";

const DEV_TOKEN_TTL_SECONDS = 300;

serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return errorResponse("method_not_allowed", 405, corsHeaders);

  const rl = await checkRateLimit(req, { windowMs: 60_000, maxRequests: 20, keyPrefix: "geocode-address" });
  if (!rl.allowed) return rateLimitResponse(rl.retryAfter ?? 60, corsHeaders);

  const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, {
    global: { headers: { Authorization: req.headers.get("Authorization") ?? "" } },
  });
  const { data: authData, error: authError } = await supabase.auth.getUser();
  if (authError || !authData?.user) return errorResponse("not_authenticated", 401, corsHeaders);
  const unconfirmedEmail = refuseUnconfirmedEmail(authData.user, corsHeaders);
  if (unconfirmedEmail) return unconfirmedEmail;

  const body = await req.json().catch(() => null) as { address?: unknown } | null;
  const address = typeof body?.address === "string" ? body.address.replace(/\s+/g, " ").trim() : "";
  if (address.length < 5 || address.length > 300) return errorResponse("invalid_address", 400, corsHeaders);

  const key = mapkitKeyFromEnv((name) => Deno.env.get(name));
  if (!key) {
    console.error(JSON.stringify({ event: "address_lookup", outcome: "not_configured" }));
    return errorResponse("geocode_unavailable", 503, corsHeaders);
  }

  const answer = await geocodeAddressPoint(address, () => signMapkitJwt(key, DEV_TOKEN_TTL_SECONDS));
  if (answer.result === "unavailable") {
    console.error(JSON.stringify({ event: "address_lookup", outcome: "unavailable", status: answer.status }));
    return errorResponse("geocode_unavailable", 503, corsHeaders);
  }
  console.log(JSON.stringify({ event: "address_lookup", outcome: answer.result === "found" ? answer.precision : "not_found" }));
  return jsonResponse(answer, 200, corsHeaders);
});
