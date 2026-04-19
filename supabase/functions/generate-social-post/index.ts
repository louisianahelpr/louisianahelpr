import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.99.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

async function generateImageForPost(postText: string, apiKey: string): Promise<string | null> {
  try {
    const imagePrompt = `A warm, photorealistic lifestyle image representing this Facebook post for Louisiana Helpr (a local app connecting people for small jobs in Louisiana). Avoid any text or logos in the image. Scene should be authentic, sunny, neighborly, and feel like Louisiana (porches, oak trees, friendly neighbors helping with yard work, cleaning, moving, etc). Post: "${postText.substring(0, 400)}"`;

    const resp = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "google/gemini-2.5-flash-image",
        messages: [{ role: "user", content: imagePrompt }],
        modalities: ["image", "text"],
      }),
    });

    if (!resp.ok) {
      console.error("Image generation failed:", resp.status, await resp.text());
      return null;
    }

    const data = await resp.json();
    const dataUrl = data.choices?.[0]?.message?.images?.[0]?.image_url?.url;
    if (!dataUrl?.startsWith("data:image/")) return null;

    // Decode base64 → upload to storage bucket
    const base64 = dataUrl.split(",")[1];
    const binary = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    const filename = `post-${Date.now()}-${crypto.randomUUID().slice(0, 8)}.png`;
    const { error: upErr } = await supabase.storage
      .from("social-posts")
      .upload(filename, binary, { contentType: "image/png", upsert: false });

    if (upErr) {
      console.error("Storage upload failed:", upErr);
      return null;
    }

    const { data: pub } = supabase.storage.from("social-posts").getPublicUrl(filename);
    return pub.publicUrl;
  } catch (e) {
    console.error("generateImageForPost error:", e);
    return null;
  }
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) throw new Error("LOVABLE_API_KEY is not configured");

    const { action, message, image_url } = await req.json();

    // Action: generate post (text + image)
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

      // Generate matching image (best-effort)
      const imageUrl = text ? await generateImageForPost(text, LOVABLE_API_KEY) : null;

      return new Response(JSON.stringify({ post: text, image_url: imageUrl }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
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
        body: JSON.stringify({ message: message.trim(), image_url: image_url || null }),
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
