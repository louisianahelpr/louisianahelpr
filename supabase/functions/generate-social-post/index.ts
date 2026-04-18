import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) throw new Error("LOVABLE_API_KEY is not configured");

    const { action, message } = await req.json();

    // Action: generate post
    if (action === "generate") {
      const response = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${LOVABLE_API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: "google/gemini-3-flash-preview",
          messages: [
            {
              role: "system",
              content: `You are a social media copywriter for Louisiana Helpr — a faceless, trustworthy local services marketplace. Speak as "the Helpr Team," never in first person. Output only the post text — no labels, no quotes, no commentary.

Every post must follow this 3-rule arc:
1. EMPATHY FIRST — open with a real Louisiana problem (heat, storms, back-to-school, long work shifts, weekend chores).
2. SHARED LOCAL PRIDE — name a specific parish or town (Vermilion, Iberia, Lafayette, Acadia, Erath, Abbeville, New Iberia, Crowley, Lake Charles, Kaplan).
3. SAFETY FOCUS — remind readers the Helpr Trust & Safety Team vets every helper (ID verification, manual review, escrow-held funds).`,
            },
            {
              role: "user",
              content: "Write a Facebook post for Louisiana Helpr following the Empathy → Local Pride → Safety arc.\n\n- Warm, Southern, professional tone\n- Under 100 words\n- 0–1 emoji max\n- No hashtags\n- End with a soft CTA and www.louisianahelpr.com",
            },
          ],
        }),
      });

      if (!response.ok) {
        const status = response.status;
        if (status === 429) return new Response(JSON.stringify({ error: "Rate limit exceeded, try again shortly." }), { status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" } });
        if (status === 402) return new Response(JSON.stringify({ error: "AI usage limit reached." }), { status: 402, headers: { ...corsHeaders, "Content-Type": "application/json" } });
        throw new Error(`AI gateway error: ${status}`);
      }

      const data = await response.json();
      const text = data.choices?.[0]?.message?.content?.trim() ?? "";
      return new Response(JSON.stringify({ post: text }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // Action: publish to Make webhook
    if (action === "publish") {
      const MAKE_WEBHOOK_URL = Deno.env.get("MAKE_WEBHOOK_URL");
      if (!MAKE_WEBHOOK_URL) throw new Error("MAKE_WEBHOOK_URL is not configured");
      if (!message || typeof message !== "string" || message.trim().length === 0) {
        return new Response(JSON.stringify({ error: "Post message is required" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }

      const webhookResp = await fetch(MAKE_WEBHOOK_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: message.trim() }),
      });

      if (!webhookResp.ok) {
        const body = await webhookResp.text();
        throw new Error(`Make webhook failed [${webhookResp.status}]: ${body}`);
      }

      return new Response(JSON.stringify({ success: true }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    return new Response(JSON.stringify({ error: "Invalid action" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (e) {
    console.error("generate-social-post error:", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
