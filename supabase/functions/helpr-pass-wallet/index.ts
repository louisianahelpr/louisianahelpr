// Helpr Pass — Apple Wallet / Google Wallet digital ID
//
// SCOPE NOTE: This is a working scaffold. To go live it needs:
//
//   1. An Apple Developer "Pass Type ID" certificate (.p12 → DER + key).
//      Set as env vars: PASS_CERT_PEM, PASS_KEY_PEM, PASS_WWDR_PEM.
//   2. A `pass-type-identifier` registered to your team (e.g.
//      "pass.com.louisianahelpr.helprpass").
//   3. Google Wallet: a JWT signing key + issuer ID from Google Pay
//      Business Console. Set as: GOOGLE_PASS_ISSUER_ID, GOOGLE_PASS_SA_KEY.
//
// Until those exist, the function returns a 501 with a clear message.
// The Elite-only gate, profile fetch, and JSON pass payload (which is
// what gets signed) are all real and ready to use the moment the certs
// arrive — only the signing step is stubbed.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.99.0";
import { checkRateLimit, rateLimitResponse } from "../_shared/rate-limit.ts";
import { TIER_DISPLAY_NAMES } from "../_shared/tierNames.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const rl = await checkRateLimit(req, {
    windowMs: 60_000,
    maxRequests: 10,
    keyPrefix: "helpr-pass-wallet",
  });
  if (!rl.allowed) return rateLimitResponse(rl.retryAfter ?? 60, corsHeaders);

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceRoleKey = (Deno.env.get("SECRET_KEY") ?? Deno.env.get("SUPABASE_SERVICE_ROLE_KEY"))!;
  const supabase = createClient(supabaseUrl, serviceRoleKey);

  try {
    // 1. Authenticate the caller — wallet passes are issued per-user.
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) throw new Error("Missing authorization");
    const supabaseAuth = createClient(
      supabaseUrl,
      (Deno.env.get("PUBLISHABLE_KEY") ?? Deno.env.get("SUPABASE_ANON_KEY"))!,
    );
    const { data: userData } = await supabaseAuth.auth.getUser(
      authHeader.replace("Bearer ", ""),
    );
    const user = userData?.user;
    if (!user) throw new Error("Not authenticated");

    // 2. Pull the profile so we can build the pass payload + verify
    //    Elite gate. Elite-only feature — anyone else gets a paywall.
    const { data: profile } = await supabase
      .from("profiles")
      .select(
        "full_name, avatar_url, subscription_tier, subscription_expires_at, idv_status, license_status, insurance_status",
      )
      .eq("user_id", user.id)
      .single();
    if (!profile) throw new Error("Profile not found");

    const subTier = (profile.subscription_tier ?? "free") as string;
    const subExp = profile.subscription_expires_at
      ? new Date(profile.subscription_expires_at)
      : null;
    const subActive = subExp ? subExp > new Date() : false;
    if (!subActive || subTier !== "elite") {
      return new Response(
        JSON.stringify({
          error: `Helpr Pass is a ${TIER_DISPLAY_NAMES.elite} perk.`,
          required_tier: "elite",
        }),
        {
          status: 402,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        },
      );
    }

    // 3. Aggregate ratings so the pass can show the live star average.
    const { data: reviews } = await supabase
      .from("reviews")
      .select("rating")
      .eq("reviewee_id", user.id);
    const ratings = (reviews ?? []).map((r) => r.rating);
    const avgRating = ratings.length > 0
      ? Math.round((ratings.reduce((a, b) => a + b, 0) / ratings.length) * 10) / 10
      : null;

    // 4. Build the pass payload — this is the JSON that gets signed
    //    + zipped into the .pkpass file Apple Wallet expects, OR the
    //    JWT claim Google Wallet expects. Same structured data either
    //    way.
    const passPayload = {
      formatVersion: 1,
      passTypeIdentifier:
        Deno.env.get("PASS_TYPE_IDENTIFIER") ?? "pass.com.louisianahelpr.helprpass",
      teamIdentifier: Deno.env.get("APPLE_TEAM_ID") ?? "TEAMID",
      organizationName: "Louisiana Helpr",
      description: `Helpr Pass — ${TIER_DISPLAY_NAMES.elite} member ID`,
      serialNumber: user.id,
      backgroundColor: "rgb(94, 101, 68)", // bark
      foregroundColor: "rgb(248, 244, 235)", // parchment
      labelColor: "rgb(212, 165, 95)", // gold-warm
      generic: {
        primaryFields: [
          { key: "name", label: "MEMBER", value: profile.full_name ?? "Helpr" },
        ],
        secondaryFields: [
          {
            key: "rating",
            label: "RATING",
            value: avgRating != null ? `${avgRating} ★` : "New",
          },
          { key: "tier", label: "TIER", value: TIER_DISPLAY_NAMES.elite },
        ],
        auxiliaryFields: [
          {
            key: "verified",
            label: "VERIFIED",
            value: profile.idv_status === "verified" ? "ID ✓" : "—",
          },
          {
            key: "credentials",
            label: "CREDENTIALS",
            value:
              profile.license_status === "verified" && profile.insurance_status === "verified"
                ? "Licensed & Insured"
                : profile.license_status === "verified"
                  ? "Licensed"
                  : profile.insurance_status === "verified"
                    ? "Insured"
                    : "—",
          },
        ],
        backFields: [
          {
            key: "issued",
            label: "Issued",
            value: new Date().toISOString(),
          },
          {
            key: "expires",
            label: "Renews",
            value: profile.subscription_expires_at ?? "",
          },
        ],
      },
    };

    // 5. Signing step — STUBBED until the Apple Pass cert is provisioned.
    //    With the cert in place the implementation is:
    //      a) Build manifest.json (SHA1 of each pass.json + image asset)
    //      b) Sign manifest.json with PKCS#7 detached signature
    //      c) Zip pass.json + manifest.json + signature + icons → .pkpass
    //      d) Return as application/vnd.apple.pkpass binary
    //
    //    Recommended library when ready: node-passkit-generator (port to
    //    Deno via esm.sh) or a pure-Deno PKCS#7 implementation. The
    //    payload shape above is the same one those libraries consume.

    const hasCert = !!(
      Deno.env.get("PASS_CERT_PEM") &&
      Deno.env.get("PASS_KEY_PEM") &&
      Deno.env.get("PASS_WWDR_PEM")
    );

    if (!hasCert) {
      return new Response(
        JSON.stringify({
          ready: false,
          message:
            "Helpr Pass signing certs not yet provisioned. Pass payload preview attached so you can verify the data shape end-to-end before going live.",
          preview: passPayload,
        }),
        {
          status: 501,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        },
      );
    }

    // The signing block below is intentionally unreachable until certs
    // exist. Future implementation slots here.
    return new Response(
      JSON.stringify({ ready: true, message: "Signing pipeline not yet implemented." }),
      { status: 501, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (error: any) {
    console.error("helpr-pass-wallet error:", error?.message ?? error);
    return new Response(JSON.stringify({ error: error?.message ?? "wallet pass failed" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
