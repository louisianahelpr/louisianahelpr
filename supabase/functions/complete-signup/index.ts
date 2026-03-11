import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    const {
      userId,
      avatarBase64,
      avatarExt,
      avatarContentType,
      idBase64,
      idExt,
      idContentType,
      portfolioFiles, // Array of { base64, ext, contentType }
      phone,
      bio,
      location,
      skills,
      dateOfBirth,
    } = await req.json();

    if (!userId) {
      return new Response(JSON.stringify({ error: "userId is required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    let avatarUrl: string | null = null;
    let idDocumentUrl: string | null = null;
    const portfolioUrls: string[] = [];

    // 1. Upload avatar
    if (avatarBase64 && avatarExt) {
      const avatarPath = `${userId}/avatar.${avatarExt}`;
      const avatarBytes = Uint8Array.from(atob(avatarBase64), (c) => c.charCodeAt(0));
      const { error: avatarErr } = await supabase.storage
        .from("job-photos")
        .upload(avatarPath, avatarBytes, {
          contentType: avatarContentType || "image/jpeg",
          upsert: true,
        });

      if (avatarErr) {
        console.error("Avatar upload error:", avatarErr);
      } else {
        const { data: urlData } = supabase.storage.from("job-photos").getPublicUrl(avatarPath);
        avatarUrl = urlData.publicUrl;
      }
    }

    // 2. Upload ID document
    if (idBase64 && idExt) {
      const idPath = `${userId}/id-document.${idExt}`;
      const idBytes = Uint8Array.from(atob(idBase64), (c) => c.charCodeAt(0));
      const { error: idErr } = await supabase.storage
        .from("id-documents")
        .upload(idPath, idBytes, {
          contentType: idContentType || "application/octet-stream",
          upsert: true,
        });

      if (idErr) {
        console.error("ID upload error:", idErr);
      } else {
        idDocumentUrl = idPath;
      }
    }

    // 3. Upload portfolio files
    if (portfolioFiles && Array.isArray(portfolioFiles)) {
      for (const file of portfolioFiles) {
        const path = `${userId}/${Date.now()}-${Math.random().toString(36).slice(2)}.${file.ext}`;
        const bytes = Uint8Array.from(atob(file.base64), (c) => c.charCodeAt(0));
        const { error: pErr } = await supabase.storage
          .from("user-documents")
          .upload(path, bytes, {
            contentType: file.contentType || "application/octet-stream",
          });

        if (!pErr) {
          const { data: pUrl } = supabase.storage.from("user-documents").getPublicUrl(path);
          portfolioUrls.push(pUrl.publicUrl);
        }
      }
    }

    // 4. Update profile
    const updateData: Record<string, unknown> = {
      approval_status: "pending",
    };
    if (phone) updateData.phone = phone;
    if (bio) updateData.bio = bio;
    if (location) updateData.location = location;
    if (skills) updateData.skills = skills;
    if (avatarUrl) updateData.avatar_url = avatarUrl;
    if (idDocumentUrl) updateData.id_document_url = idDocumentUrl;
    if (portfolioUrls.length > 0) updateData.portfolio_urls = portfolioUrls;

    const { error: profileErr } = await supabase
      .from("profiles")
      .update(updateData)
      .eq("user_id", userId);

    if (profileErr) {
      console.error("Profile update error:", profileErr);
      return new Response(JSON.stringify({ error: "Failed to update profile" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    return new Response(
      JSON.stringify({ success: true, avatarUrl, idDocumentUrl, portfolioUrls }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err) {
    console.error("Error:", err);
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
