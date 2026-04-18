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
              content: "You are a social media copywriter for Louisiana Helpr, a local app that connects people with nearby help for small jobs and tasks. You only output the post text, nothing else — no labels, no quotes, no extra commentary.",
            },
            {
              role: "user",
              content: "Write a Facebook post for Louisiana Helpr.\n\nMake it:\n- catchy hook\n- relatable\n- short (under 100 words)\n- include 1–2 emojis\n- end with a call to action\n\nTone: friendly, local, slightly casual",
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
