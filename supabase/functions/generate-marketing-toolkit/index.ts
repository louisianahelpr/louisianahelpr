import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

// 4 monthly posts — one per Content Pillar
const PILLAR_BRIEFS = [
  {
    pillar: "Safety",
    angle: "Reinforce that every helper is identity-verified through Stripe and that escrow protects every dollar until the job is done right.",
    suggested_day: "Tuesday",
    suggested_time: "10:00 AM",
  },
  {
    pillar: "Local Wins",
    angle: "Celebrate a recent win in Acadiana — a yard transformed in Erath, a moving job knocked out in New Iberia, a pressure-washing job in Abbeville. Keep it human and specific without naming real people.",
    suggested_day: "Thursday",
    suggested_time: "6:30 PM",
  },
  {
    pillar: "Planning",
    angle: "Help posters plan ahead — seasonal yard prep, weekend chore lists, party setup, holiday cleanups. Position Helpr as the easy way to book a trusted neighbor in advance.",
    suggested_day: "Sunday",
    suggested_time: "4:00 PM",
  },
  {
    pillar: "Community",
    angle: "Highlight that Helpr is built by Louisianans, for Louisianans — neighbors helping neighbors across Vermilion, Iberia, Lafayette, Acadia, and Calcasieu Parishes.",
    suggested_day: "Wednesday",
    suggested_time: "1:00 PM",
  },
];

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) throw new Error("LOVABLE_API_KEY is not configured");

    const systemPrompt = `You are a seasoned Southern copywriter for Louisiana Helpr — a trusted, faceless local services marketplace serving Louisiana parishes.

WRITING STYLE:
- Southern professional: warm, neighborly, credible — like a small-town bank ad, not a slangy meme.
- Conversational but never robotic. Avoid AI tells like "in today's fast-paced world", "look no further", "elevate", or "unlock".
- Vary sentence length. Use one short punchy line, then a longer one. Read it out loud — it should sound like a real person from Acadiana.
- Mention specific Louisiana parishes or towns naturally (Vermilion, Iberia, Lafayette, Acadia, Calcasieu, Erath, Abbeville, New Iberia, Crowley, Lake Charles).

STRICT RULES:
- 60–95 words per caption.
- NO hashtags.
- NO personal names, NO founder references, NO "I" or "we built this" — speak as the brand.
- 1 subtle emoji max (optional, only if it genuinely fits).
- End with a soft call-to-action and the URL www.louisianahelpr.com.
- Output ONLY the caption text — no labels, no quotes, no commentary.`;

    const userPrompt = `Write 4 distinct Facebook captions — one for each Content Pillar below. Output as a JSON array of 4 objects, each with fields: "pillar", "suggested_day", "suggested_time", "caption". Do not wrap in markdown — return raw JSON only.

Briefs:
${PILLAR_BRIEFS.map((b, i) => `${i + 1}. [${b.pillar}] ${b.angle} (Best post time: ${b.suggested_day} ${b.suggested_time})`).join("\n")}`;

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
    console.error("generate-marketing-toolkit error:", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
