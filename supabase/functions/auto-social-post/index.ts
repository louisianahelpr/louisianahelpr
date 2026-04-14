import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.99.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const POST_STYLES = [
  "Launch / Awareness: Introduce Louisiana Helpr, explain what it does, keep it simple and inviting. End with a link to www.louisianahelpr.com",
  "Problem → Solution: Start with a relatable problem (needing help, can't find anyone), then position Louisiana Helpr as the easy answer.",
  "Relatable / Viral: Use humor or a very relatable 'Louisiana problems' angle. Keep it casual, meme-like energy. Short and punchy.",
  "Trust-Building: List reasons people use Louisiana Helpr (find help fast, real local people, simple). Build credibility without being salesy.",
  "Call-to-Action: Direct and clear — need help? Post a job on Louisiana Helpr. Link to www.louisianahelpr.com. Urgency without pressure.",
  "Engagement: Ask the audience a question to boost comments. Example: 'What's something you wish you had help with right now?'",
  "Testimonial Style: Write as if sharing someone's experience. Focus on the relief of finding help quickly through the app.",
  "Short & Punchy: Ultra-short post, 2-3 lines max. Like a reel caption. Post → Match → Done energy.",
];

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  // Verify cron secret
  const cronSecret = Deno.env.get("CRON_SECRET");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const authHeader = req.headers.get("Authorization");
  if (!authHeader || ((!cronSecret || authHeader !== `Bearer ${cronSecret}`) && (!serviceRoleKey || authHeader !== `Bearer ${serviceRoleKey}`))) {
    return new Response("Unauthorized", { status: 401, headers: corsHeaders });
  }

  try {
    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) throw new Error("LOVABLE_API_KEY is not configured");
    const MAKE_WEBHOOK_URL = Deno.env.get("MAKE_WEBHOOK_URL");
    if (!MAKE_WEBHOOK_URL) throw new Error("MAKE_WEBHOOK_URL is not configured");

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    const style = POST_STYLES[Math.floor(Math.random() * POST_STYLES.length)];

    // Generate post with AI
    const aiResp = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
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
            content: "You are a social media copywriter for Louisiana Helpr — a local app that connects people with nearby help for small jobs and tasks. You only output the post text, nothing else. No labels, no quotes, no commentary. Include 1-2 relevant hashtags at the end.",
          },
          {
            role: "user",
            content: `Write a Facebook post in this style:\n\n${style}\n\nRules:\n- Under 120 words\n- 1–2 emojis\n- Friendly, local, slightly casual tone\n- End with a call to action\n- Include #LouisianaHelpr hashtag`,
          },
        ],
      }),
    });

    if (!aiResp.ok) throw new Error(`AI gateway error: ${aiResp.status}`);

    const aiData = await aiResp.json();
    const postText = aiData.choices?.[0]?.message?.content?.trim();
    if (!postText) throw new Error("AI returned empty content");

    // Post directly to Facebook via Make webhook
    const webhookResp = await fetch(MAKE_WEBHOOK_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message: postText }),
    });

    if (!webhookResp.ok) {
      const body = await webhookResp.text();
      throw new Error(`Make webhook failed [${webhookResp.status}]: ${body}`);
    }

    // Log the published post
    await supabase
      .from("social_post_drafts")
      .insert({ content: postText, style, status: "published", published_at: new Date().toISOString() });

    console.log("Auto-posted to Facebook:", postText.substring(0, 80) + "...");

    return new Response(JSON.stringify({ success: true, post: postText, style }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("auto-social-post error:", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
