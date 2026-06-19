import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { checkRateLimit, rateLimitResponse } from "../_shared/rate-limit.ts";
import { corsHeadersFull as corsHeaders, jsonResponse, errorResponse } from "../_shared/cors.ts";

// F-SEC-05: public partner-application intake. Previously the /become-a-partner
// page inserted directly into partner_applications as anon (broad anon grant +
// permissive INSERT policy). That let anyone script unlimited rows. This
// function is the single anon-facing write path: IP-rate-limited, server-side
// validated, and inserting via the service-role key. The direct anon grant is
// revoked in the accompanying migration so this is the only way in.

const REQUIRED: Array<[string, string]> = [
  ["business_name", "Business name"],
  ["contact_name", "Contact name"],
  ["contact_email", "Contact email"],
  ["service_category", "Service category"],
  ["service_area", "Service area"],
  ["team_size", "Team size"],
  ["years_in_business", "Years in business"],
];

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const str = (v: unknown, max: number): string =>
  typeof v === "string" ? v.trim().slice(0, max) : "";

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }
  if (req.method !== "POST") {
    return errorResponse("Method not allowed", 405, corsHeaders);
  }

  // Throttle: 5 submissions per IP per 10 min. Generous for a legitimate
  // applicant, tight enough to stop spam floods.
  const rl = await checkRateLimit(req, {
    windowMs: 10 * 60_000,
    maxRequests: 5,
    keyPrefix: "submit-partner-application",
  });
  if (!rl.allowed) return rateLimitResponse(rl.retryAfter ?? 60, corsHeaders);

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return errorResponse("Invalid request body", 400, corsHeaders);
  }

  const row = {
    business_name: str(body.business_name, 200),
    contact_name: str(body.contact_name, 200),
    contact_email: str(body.contact_email, 320),
    contact_phone: str(body.contact_phone, 40) || null,
    service_category: str(body.service_category, 100),
    service_area: str(body.service_area, 300),
    team_size: str(body.team_size, 50),
    years_in_business: str(body.years_in_business, 50),
    has_insurance: body.has_insurance === true,
    has_license: body.has_license === true,
    referral_source: str(body.referral_source, 300) || null,
  };

  for (const [field, label] of REQUIRED) {
    if (!row[field as keyof typeof row]) {
      return errorResponse(`${label} is required`, 400, corsHeaders);
    }
  }
  if (!EMAIL_RE.test(row.contact_email)) {
    return errorResponse("Please enter a valid email address", 400, corsHeaders);
  }

  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      (Deno.env.get("SECRET_KEY") ?? Deno.env.get("SUPABASE_SERVICE_ROLE_KEY"))!,
    );

    const { error } = await supabase.from("partner_applications").insert(row);
    if (error) {
      console.error("partner_applications insert failed", error);
      return errorResponse("Couldn't submit your application", 500, corsHeaders);
    }

    return jsonResponse({ ok: true }, 200, corsHeaders);
  } catch (err) {
    console.error("submit-partner-application error", err);
    return errorResponse("Couldn't submit your application", 500, corsHeaders);
  }
});
