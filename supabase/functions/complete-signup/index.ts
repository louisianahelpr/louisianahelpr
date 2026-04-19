import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
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

    const body = await req.json();
    const {
      userId: bodyUserId,
      avatarBase64,
      avatarExt,
      avatarContentType,
      idBase64,
      idExt,
      idContentType,
      portfolioFiles,
      phone,
      bio,
      location,
      skills,
      dateOfBirth,
      availability,
      transportation,
      hearAboutUs,
      experienceLevel,
      toolsEquipment,
      emergencyContactName,
      emergencyContactPhone,
      jobRadius,
      extraComments,
    } = body;

    let userId: string | null = null;

    // Try JWT auth first (for resubmissions from logged-in users)
    const authHeader = req.headers.get("Authorization");
    if (authHeader) {
      const anonClient = createClient(
        Deno.env.get("SUPABASE_URL")!,
        Deno.env.get("SUPABASE_ANON_KEY")!
      );
      const token = authHeader.replace("Bearer ", "");
      const { data: authData, error: authError } = await anonClient.auth.getUser(token);
      if (!authError && authData.user) {
        userId = authData.user.id;
      }
    }

    // If no valid JWT, allow initial signup completion ONLY within a short
    // window after account creation, and only if the profile is still empty.
    // This prevents an attacker who learns another user's UUID (e.g. from
    // job listings) from overwriting their unfinished profile.
    if (!userId && bodyUserId) {
      // Verify user exists in auth.users via service role
      const { data: authUser, error: authCheckErr } = await supabase.auth.admin.getUserById(bodyUserId);
      if (authCheckErr || !authUser?.user) {
        return new Response(JSON.stringify({ error: "Invalid user" }), {
          status: 401,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      // Enforce a 30-minute window from account creation. After that, the
      // user must log in (which provides a JWT) to complete/resubmit.
      const createdAt = authUser.user.created_at ? new Date(authUser.user.created_at).getTime() : 0;
      const ageMs = Date.now() - createdAt;
      const WINDOW_MS = 30 * 60 * 1000;
      if (!createdAt || ageMs > WINDOW_MS) {
        return new Response(
          JSON.stringify({ error: "Signup completion window expired. Please log in to finish your profile." }),
          { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      // Reject if the user has ever signed in — a logged-in user must use their JWT.
      if (authUser.user.last_sign_in_at) {
        return new Response(
          JSON.stringify({ error: "Account already active. Please log in to update your profile." }),
          { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      // Only allow if profile is in initial empty state (no bio set yet)
      const { data: existingProfile } = await supabase
        .from("profiles")
        .select("bio, approval_status")
        .eq("user_id", bodyUserId)
        .single();

      if (!existingProfile) {
        return new Response(JSON.stringify({ error: "Profile not found" }), {
          status: 404,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      // Only allow unauthenticated completion if profile is truly empty
      if (existingProfile.bio && existingProfile.bio.trim().length > 0) {
        return new Response(JSON.stringify({ error: "Profile already completed. Please log in." }), {
          status: 403,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      // Block resubmissions through the unauthenticated path — denied users must log in.
      if (existingProfile.approval_status === "denied") {
        return new Response(
          JSON.stringify({ error: "Please log in to resubmit your application." }),
          { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      userId = bodyUserId;
    }

    if (!userId) {
      return new Response(JSON.stringify({ error: "Not authenticated and no valid userId provided" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Enforce file size limits (5 MB max per file)
    const MAX_FILE_SIZE = 5 * 1024 * 1024;
    const checkBase64Size = (b64: string | null, label: string) => {
      if (!b64) return;
      const sizeBytes = Math.ceil(b64.length * 3 / 4);
      if (sizeBytes > MAX_FILE_SIZE) {
        throw new Error(`${label} exceeds 5 MB limit`);
      }
    };
    checkBase64Size(avatarBase64, "Profile picture");
    checkBase64Size(idBase64, "ID document");
    if (portfolioFiles && Array.isArray(portfolioFiles)) {
      for (const f of portfolioFiles) {
        checkBase64Size(f.base64, "Portfolio file");
      }
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

    // 4. Check current profile to determine if this is a resubmission
    const { data: currentProfile } = await supabase
      .from("profiles")
      .select("approval_status, application_count")
      .eq("user_id", userId)
      .single();

    const isResubmission = currentProfile?.approval_status === "denied";

    // For resubmissions, require all essential documents and fields
    if (isResubmission) {
      const missing: string[] = [];
      if (!avatarUrl) missing.push("profile picture");
      if (!idDocumentUrl) missing.push("ID document");
      if (!bio) missing.push("bio");
      if (!phone) missing.push("phone number");
      if (!location) missing.push("location");

      if (missing.length > 0) {
        return new Response(
          JSON.stringify({ error: `Resubmission requires: ${missing.join(", ")}. Please complete all required fields.` }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
    }

    // 5. Update profile
    const updateData: Record<string, unknown> = {
      approval_status: "pending",
    };

    if (isResubmission) {
      updateData.application_count = (currentProfile?.application_count || 1) + 1;
      updateData.denial_reason = null;
    }
    if (phone) updateData.phone = phone;
    if (bio) updateData.bio = bio;
    if (location) updateData.location = location;
    if (skills) updateData.skills = skills;
    if (dateOfBirth) updateData.date_of_birth = dateOfBirth;
    if (avatarUrl) updateData.avatar_url = avatarUrl;
    if (idDocumentUrl) updateData.id_document_url = idDocumentUrl;
    if (portfolioUrls.length > 0) updateData.portfolio_urls = portfolioUrls;
    if (availability) updateData.availability = availability;
    if (transportation) updateData.transportation = transportation;
    if (hearAboutUs) updateData.hear_about_us = hearAboutUs;
    if (experienceLevel) updateData.experience_level = experienceLevel;
    if (toolsEquipment) updateData.tools_equipment = toolsEquipment;
    if (emergencyContactName) updateData.emergency_contact_name = emergencyContactName;
    if (emergencyContactPhone) updateData.emergency_contact_phone = emergencyContactPhone;
    if (jobRadius) updateData.job_radius = jobRadius;
    if (extraComments) updateData.extra_comments = extraComments;

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

    // Notify all admins about the new signup (deduped: skip if we already sent one for this user in the last 24h)
    try {
      const { data: profile } = await supabase
        .from("profiles")
        .select("full_name, location, role")
        .eq("user_id", userId)
        .single();

      const userName = profile?.full_name || "Someone";
      const userLocation = profile?.location ? ` from ${profile.location}` : "";
      const userRole = profile?.role || "user";
      const notifMessage = `${userName}${userLocation} just signed up as a ${userRole}. Tap to review their profile.`;

      // Dedupe: skip if an identical notification was sent in the last 24h
      const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
      const { data: existing } = await supabase
        .from("notifications")
        .select("id")
        .eq("title", "👤 New signup pending review")
        .eq("message", notifMessage)
        .gte("created_at", since)
        .limit(1);

      if (!existing?.length) {
        const { data: admins } = await supabase
          .from("user_roles")
          .select("user_id")
          .eq("role", "admin");

        if (admins?.length) {
          const adminNotifs = admins.map((admin: { user_id: string }) => ({
            user_id: admin.user_id,
            title: "👤 New signup pending review",
            message: notifMessage,
            type: "info",
            link: "/admin",
          }));

          await supabase.from("notifications").insert(adminNotifs);
        }
      }
    } catch (notifErr) {
      console.error("Failed to notify admins:", notifErr);
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
