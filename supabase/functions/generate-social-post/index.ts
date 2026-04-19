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

    const { action, message, image_url, video_url } = await req.json();

    // Determine alternation: look at last draft, flip media type
    const supabaseClient = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    // Action: generate post (text + image OR video)
    if (action === "generate") {
      // Decide media type — alternate from last draft
      const { data: lastDraft } = await supabaseClient
        .from("social_post_drafts")
        .select("media_type")
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      const nextMediaType = lastDraft?.media_type === "image" ? "video" : "image";
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
              content: `You are a social media copywriter for Louisiana Helpr — a brand-new Louisiana-only app that connects neighbors with trusted local helpers for small jobs (lawn care, cleaning, moving, handyman work, errands, pressure washing, etc.).

We are in our LAUNCH MONTH. The goal of every post right now is to INTRODUCE the app, EXPLAIN how it works, and BUILD TRUST in our community values — NOT to push individual jobs yet.

Brand voice: warm, neighborly, proudly Louisiana, slightly casual. Talk like a friend on the porch. Light Louisiana flavor is welcome ("y'all", "geaux", parish names, gumbo references — but don't overdo it, max 1 per post).

Core community beliefs to weave in:
• Neighbors helping neighbors — old-school Louisiana hospitality
• 100% local: every helper lives right here in Louisiana
• Fair pay for honest work (helpers keep 90% of what they earn)
• Safe & verified: every helper is ID-verified
• Money held in escrow until the job is done right
• No middlemen squeezing y'all — just a small fee that keeps the lights on

You output ONLY the post text. No labels, no quotes, no hashtag lists at the end unless they flow naturally, no "Here's your post:" preamble.`,
            },
            {
              role: "user",
              content: `Write ONE Facebook post for Louisiana Helpr's launch month. Pick ONE of these angles at random and commit to it fully (don't try to cover all of them):

1. "What is Helpr?" — explain in plain language what the app does and who it's for
2. "How it works in 3 steps" — post a job, pick a helper, pay safely after it's done
3. "Why we built this" — Louisiana neighbors deserve a local-first option, not a faceless national app
4. "Meet your helpers" — describe the kind of trustworthy folks who sign up (verified, local, vetted)
5. "Safe & secure" — explain ID verification + escrow payments in friendly terms
6. "Fair pay" — helpers keep 90%, no shady cuts
7. "Community values" — what we believe about work, neighbors, and Louisiana
8. "Common jobs" — examples of what people are using Helpr for (lawn care, cleaning, moving help, etc.)
9. "Why local matters" — every dollar stays in Louisiana
10. "Founder note" — a sincere, simple message about the mission

Rules:
- Under 100 words
- 1–2 emojis max, placed naturally (not stuffed)
- Strong opening hook in the first line
- End with a soft CTA: "Download Helpr today", "Join the waitlist", "Tell a neighbor", "Try it free this month", or similar
- NO sales-y language, NO ALL CAPS, NO clickbait
- Sound like a real Louisiana person wrote it, not a corporate brand`,
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

      // Generate matching media (image or video, depending on alternation)
      let imageUrl: string | null = null;
      let videoUrl: string | null = null;

      if (nextMediaType === "image") {
        imageUrl = text ? await generateImageForPost(text, LOVABLE_API_KEY) : null;
      } else {
        // Video generation requires a third-party API (not yet wired).
        // For now: still generate a poster image, and flag this draft as a video slot.
        imageUrl = text ? await generateImageForPost(text, LOVABLE_API_KEY) : null;
        videoUrl = null; // admin can attach a video URL manually until video API is wired
      }

      return new Response(
        JSON.stringify({ post: text, image_url: imageUrl, video_url: videoUrl, media_type: nextMediaType }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
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
        body: JSON.stringify({
          message: message.trim(),
          image_url: image_url || null,
          video_url: video_url || null,
          media_type: video_url ? "video" : "image",
        }),
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
