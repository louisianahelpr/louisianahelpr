// Captures business / commercial leads from the public landing page
// and pipes them into HubSpot CRM as Contacts. Public endpoint with light
// in-memory rate limiting. Falls back gracefully if HubSpot isn't configured.

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

const GATEWAY_URL = "https://connector-gateway.lovable.dev/hubspot";

// Naive in-memory rate limit: 5 requests / IP / 10 min. Resets on cold start.
const RATE_LIMIT_WINDOW_MS = 10 * 60 * 1000;
const RATE_LIMIT_MAX = 5;
const ipHits = new Map<string, { count: number; reset: number }>();

interface LeadBody {
  email: string;
  firstName?: string;
  lastName?: string;
  company?: string;
  phone?: string;
  parish?: string;
  message?: string;
  source?: string; // e.g. "landing_for_business"
}

function isValidEmail(e: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e);
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "anon";
    const now = Date.now();
    const entry = ipHits.get(ip);
    if (entry && entry.reset > now) {
      if (entry.count >= RATE_LIMIT_MAX) {
        return new Response(JSON.stringify({ error: "Too many requests. Please try again later." }), {
          status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      entry.count++;
    } else {
      ipHits.set(ip, { count: 1, reset: now + RATE_LIMIT_WINDOW_MS });
    }

    const body = (await req.json()) as LeadBody;

    if (!body.email || !isValidEmail(body.email)) {
      return new Response(JSON.stringify({ error: "Valid email required" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    const HUBSPOT_API_KEY = Deno.env.get("HUBSPOT_API_KEY");

    if (!LOVABLE_API_KEY || !HUBSPOT_API_KEY) {
      // CRM not configured — still return success so the form UX works.
      console.warn("HubSpot not configured; lead dropped:", body.email);
      return new Response(JSON.stringify({ ok: true, queued: true }), {
        status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const properties: Record<string, string> = {
      email: body.email.trim().toLowerCase(),
      lifecyclestage: "lead",
      hs_lead_status: "NEW",
    };
    if (body.firstName) properties.firstname = body.firstName.trim().slice(0, 100);
    if (body.lastName) properties.lastname = body.lastName.trim().slice(0, 100);
    if (body.company) properties.company = body.company.trim().slice(0, 200);
    if (body.phone) properties.phone = body.phone.trim().slice(0, 30);
    if (body.parish) properties.state = body.parish; // map parish to HS state-ish field
    if (body.message) properties.message = body.message.trim().slice(0, 2000);
    properties.lead_source = body.source || "louisianahelpr.com";

    // Create or update (upsert by email)
    const resp = await fetch(`${GATEWAY_URL}/crm/v3/objects/contacts`, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${LOVABLE_API_KEY}`,
        "X-Connection-Api-Key": HUBSPOT_API_KEY,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ properties }),
    });

    if (resp.status === 409) {
      // Already exists — update
      const existing = await resp.json();
      const existingId = existing?.message?.match(/ID:\s*(\d+)/)?.[1];
      if (existingId) {
        await fetch(`${GATEWAY_URL}/crm/v3/objects/contacts/${existingId}`, {
          method: "PATCH",
          headers: {
            "Authorization": `Bearer ${LOVABLE_API_KEY}`,
            "X-Connection-Api-Key": HUBSPOT_API_KEY,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ properties }),
        });
      }
      return new Response(JSON.stringify({ ok: true, updated: true }), {
        status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (!resp.ok) {
      const text = await resp.text();
      console.error("HubSpot lead create failed:", resp.status, text);
      // Don't surface CRM errors to the public; return ok so the user UX still works.
      return new Response(JSON.stringify({ ok: true, queued: true }), {
        status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    return new Response(JSON.stringify({ ok: true, created: true }), {
      status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e: any) {
    console.error("hubspot-lead-capture error:", e);
    return new Response(JSON.stringify({ error: e.message || "Unknown error" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
