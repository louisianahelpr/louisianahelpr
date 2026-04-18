import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

// 12 prompts/month: 4 Safety, 4 Posters, 4 Helpers
const CAPTION_BRIEFS = [
  // ── SAFETY (Trust) ──
  { pillar: "Safety", topic: "Stripe identity verification protects every helper and poster.", suggested_day: "Tuesday", suggested_time: "10:00 AM" },
  { pillar: "Safety", topic: "Escrow payments — money is held until the job is done right.", suggested_day: "Tuesday", suggested_time: "10:00 AM" },
  { pillar: "Safety", topic: "All helpers are reviewed and rated by real Louisiana neighbors.", suggested_day: "Tuesday", suggested_time: "10:00 AM" },
  { pillar: "Safety", topic: "In-app messaging keeps phone numbers private and conversations on the record.", suggested_day: "Tuesday", suggested_time: "10:00 AM" },

  // ── POSTERS (Efficiency / Community) ──
  { pillar: "Posters", topic: "Weekend chores piling up? Let a trusted neighbor knock them out.", suggested_day: "Thursday", suggested_time: "6:00 PM" },
  { pillar: "Posters", topic: "Now serving Vermilion and Iberia Parishes — post a job in minutes.", suggested_day: "Wednesday", suggested_time: "1:00 PM" },
  { pillar: "Posters", topic: "Lawn care, pressure washing, moving help — one app, local helpers.", suggested_day: "Saturday", suggested_time: "9:00 AM" },
  { pillar: "Posters", topic: "Set your budget, pick your time, and a helper from Erath or Abbeville is on the way.", suggested_day: "Monday", suggested_time: "12:00 PM" },

  // ── HELPERS (Opportunity) ──
  { pillar: "Helpers", topic: "Looking for a side hustle in Acadiana? Become a Helpr.", suggested_day: "Sunday", suggested_time: "7:00 PM" },
  { pillar: "Helpers", topic: "Get paid weekly through secure direct deposit — no chasing checks.", suggested_day: "Friday", suggested_time: "5:00 PM" },
  { pillar: "Helpers", topic: "Choose your parishes, set your hours, work when you want.", suggested_day: "Sunday", suggested_time: "7:00 PM" },
  { pillar: "Helpers", topic: "Build a 5-star reputation in your hometown — Lafayette, New Iberia, Crowley.", suggested_day: "Wednesday", suggested_time: "11:00 AM" },
];

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) throw new Error("LOVABLE_API_KEY is not configured");

    const systemPrompt = `You are a professional social media copywriter for Louisiana Helpr — a faceless, trustworthy local services marketplace serving Louisiana parishes.

STRICT RULES:
- Southern professional tone (warm but credible — never slangy, never personal)
- NO hashtags
- NO personal names, NO founder references, NO "I" or "we built this" — speak as the brand
- Mention specific Louisiana parishes or towns where relevant (Vermilion, Iberia, Lafayette, Acadia, Erath, Abbeville, New Iberia, Crowley, Lake Charles)
- 50–90 words per caption
- 1 subtle emoji max (optional)
- End with a soft call-to-action and the URL www.louisianahelpr.com
- Output ONLY the caption text — no labels, no quotes, no commentary`;

    const userPrompt = `Write 12 distinct Facebook captions following the briefs below. Output as a JSON array of 12 objects, each with fields: "pillar", "suggested_day", "suggested_time", "caption". Do not wrap in markdown — return raw JSON only.

Briefs:
${CAPTION_BRIEFS.map((b, i) => `${i + 1}. [${b.pillar}] ${b.topic} (Best: ${b.suggested_day} ${b.suggested_time})`).join("\n")}`;

    const aiResp = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${LOVABLE_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "google/gemini-2.5-flash",
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt },
        ],
      }),
    });

    if (!aiResp.ok) {
      const status = aiResp.status;
      if (status === 429) return new Response(JSON.stringify({ error: "Rate limit reached. Try again shortly." }), { status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      if (status === 402) return new Response(JSON.stringify({ error: "AI usage limit reached." }), { status: 402, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      throw new Error(`AI gateway error: ${status}`);
    }

    const data = await aiResp.json();
    let raw = data.choices?.[0]?.message?.content?.trim() ?? "[]";
    // Strip markdown fences if model added them
    raw = raw.replace(/^```json\s*/i, "").replace(/^```\s*/i, "").replace(/```\s*$/i, "").trim();

    let captions: any[] = [];
    try {
      captions = JSON.parse(raw);
    } catch {
      throw new Error("AI returned invalid JSON. Please try again.");
    }

    if (!Array.isArray(captions) || captions.length === 0) {
      throw new Error("AI returned no captions.");
    }

    return new Response(JSON.stringify({ captions, generated_at: new Date().toISOString() }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("generate-marketing-batch error:", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
