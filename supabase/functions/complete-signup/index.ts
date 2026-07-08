import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { checkRateLimit, rateLimitResponse } from "../_shared/rate-limit.ts";
import { LEGAL_TERMS_VERSION, LEGAL_PRIVACY_VERSION } from "../_shared/legalVersions.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  // Throttle: 5 completions per IP per 5 min. Each call uploads avatar/ID/
  // license/insurance/portfolio files to storage and writes a profile row, so
  // a script abusing this can fill storage quota fast.
  const rl = await checkRateLimit(req, {
    windowMs: 5 * 60_000,
    maxRequests: 5,
    keyPrefix: "complete-signup",
  });
  if (!rl.allowed) return rateLimitResponse(rl.retryAfter ?? 60, corsHeaders);

  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      (Deno.env.get("SECRET_KEY") ?? Deno.env.get("SUPABASE_SERVICE_ROLE_KEY"))!
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
      licenseBase64,
      licenseExt,
      licenseContentType,
      isLicensed,
      insuranceBase64,
      insuranceExt,
      insuranceContentType,
      isInsured,
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
        (Deno.env.get("PUBLISHABLE_KEY") ?? Deno.env.get("SUPABASE_ANON_KEY"))!
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
    checkBase64Size(licenseBase64, "License document");
    checkBase64Size(insuranceBase64, "Insurance document");
    if (portfolioFiles && Array.isArray(portfolioFiles)) {
      for (const f of portfolioFiles) {
        checkBase64Size(f.base64, "Portfolio file");
      }
    }

    let avatarUrl: string | null = null;
    let idDocumentUrl: string | null = null;
    let licenseUrl: string | null = null;
    let insuranceUrl: string | null = null;
    const portfolioUrls: string[] = [];

    // 1. Upload avatar to the dedicated public `avatars` bucket
    // (was incorrectly using job-photos before — bucket got created
    // 2026-05-05 alongside making user-documents private).
    if (avatarBase64 && avatarExt) {
      const avatarPath = `${userId}/avatar.${avatarExt}`;
      const avatarBytes = Uint8Array.from(atob(avatarBase64), (c) => c.charCodeAt(0));
      const { error: avatarErr } = await supabase.storage
        .from("avatars")
        .upload(avatarPath, avatarBytes, {
          contentType: avatarContentType || "image/jpeg",
          upsert: true,
        });

      if (avatarErr) {
        console.error("Avatar upload error:", avatarErr);
      } else {
        const { data: urlData } = supabase.storage.from("avatars").getPublicUrl(avatarPath);
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

    // 2b. Upload license document (if provided)
    // user-documents bucket is private — store the PATH (not full URL) so
    // we can generate signed URLs at display time. Admin/owner read access
    // is enforced by the bucket's owner-or-admin RLS policy.
    if (licenseBase64 && licenseExt) {
      const licensePath = `${userId}/credentials/license-${Date.now()}.${licenseExt}`;
      const licenseBytes = Uint8Array.from(atob(licenseBase64), (c) => c.charCodeAt(0));
      const { error: licErr } = await supabase.storage
        .from("user-documents")
        .upload(licensePath, licenseBytes, {
          contentType: licenseContentType || "application/octet-stream",
          upsert: true,
        });
      if (licErr) {
        console.error("License upload error:", licErr);
      } else {
        licenseUrl = licensePath;  // path, not URL — see column COMMENT
      }
    }

    // 2c. Upload insurance document (if provided)
    if (insuranceBase64 && insuranceExt) {
      const insurancePath = `${userId}/credentials/insurance-${Date.now()}.${insuranceExt}`;
      const insuranceBytes = Uint8Array.from(atob(insuranceBase64), (c) => c.charCodeAt(0));
      const { error: insErr } = await supabase.storage
        .from("user-documents")
        .upload(insurancePath, insuranceBytes, {
          contentType: insuranceContentType || "application/octet-stream",
          upsert: true,
        });
      if (insErr) {
        console.error("Insurance upload error:", insErr);
      } else {
        insuranceUrl = insurancePath;  // path, not URL
      }
    }

    // 3. Upload portfolio files
    // Portfolio files are public-display content (helper portfolios shown
    // on profiles), but they live in user-documents under each user's
    // folder. Since user-documents is now private, we generate signed URLs
    // with a long TTL (1 year) at upload time. Helpers viewing their own
    // portfolio + admins still get fresh signed URLs at display time too.
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
          // Store the path. portfolio_urls[] consumers must regenerate
          // signed URLs at display time (same pattern as license/insurance).
          portfolioUrls.push(path);
        }
      }
    }

    // 3b. A PROVIDED document that failed to upload must NOT slip through to
    // auto-approval. Each upload block above only console.error'd on failure
    // and continued, so a user could submit an ID / license / insurance, have
    // the storage write fail, and still land "approved" with the doc missing.
    // Detect provided-but-unstored files and make the caller retry instead.
    const uploadFailures: string[] = [];
    if (avatarBase64 && avatarExt && !avatarUrl) uploadFailures.push("profile picture");
    if (idBase64 && idExt && !idDocumentUrl) uploadFailures.push("ID document");
    if (licenseBase64 && licenseExt && !licenseUrl) uploadFailures.push("license");
    if (insuranceBase64 && insuranceExt && !insuranceUrl) uploadFailures.push("insurance document");
    if (uploadFailures.length > 0) {
      return new Response(
        JSON.stringify({ error: `We couldn't save your ${uploadFailures.join(", ")}. Please try again.` }),
        { status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // 4. Check current profile to determine if this is a resubmission
    const { data: currentProfile } = await supabase
      .from("profiles")
      .select("approval_status, application_count, date_of_birth")
      .eq("user_id", userId)
      .single();

    const isResubmission = currentProfile?.approval_status === "denied";

    // 4b. Server-side 18+ gate. The signup UI validates this too, but a
    // direct API call could otherwise skip it and land on "approved" with
    // no (or an underage) date of birth — this is a legal requirement on a
    // real-money platform, so it must be enforced here, not just client-side.
    const effectiveDob: string | null = dateOfBirth || currentProfile?.date_of_birth || null;
    if (!effectiveDob) {
      return new Response(
        JSON.stringify({ error: "Date of birth is required. You must be at least 18 to use Helpr." }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }
    const dob = new Date(effectiveDob);
    if (isNaN(dob.getTime())) {
      return new Response(
        JSON.stringify({ error: "Invalid date of birth." }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }
    const cutoff = new Date();
    cutoff.setFullYear(cutoff.getFullYear() - 18);
    if (dob > cutoff) {
      return new Response(
        JSON.stringify({ error: "You must be at least 18 years old to use Helpr." }),
        { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Require the essential profile fields on EVERY path, not just
    // resubmissions. This function auto-approves, so a direct API call that
    // skipped the signup UI could otherwise land on "approved" with a blank
    // profile. avatar/bio/phone/location are collected by the initial signup
    // flow (Signup.tsx validateAboutYouStep), so requiring them here matches
    // what a real signup already sends. The ID document is resubmission-only —
    // initial signup collects no ID (Stripe IDV handles identity later), so it
    // must not be required on the initial path or it would reject real signups.
    const missing: string[] = [];
    if (!avatarUrl) missing.push("profile picture");
    if (!bio) missing.push("bio");
    if (!phone) missing.push("phone number");
    if (!location) missing.push("location");
    if (isResubmission && !idDocumentUrl) missing.push("ID document");

    if (missing.length > 0) {
      return new Response(
        JSON.stringify({ error: `Please complete all required fields: ${missing.join(", ")}.` }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // 5. Update profile. Auto-approve — there's no manual admin review
    // step anymore. As long as the user submitted all required fields
    // (validated above), they're cleared the moment this function
    // succeeds. Identity verification + payout setup happen later as
    // separate Stripe-gated steps when posting / applying / accepting.
    const updateData: Record<string, unknown> = {
      approval_status: "approved",
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
    if (typeof isLicensed === "boolean") {
      updateData.is_licensed = isLicensed;
      if (isLicensed && licenseUrl) {
        updateData.license_url = licenseUrl;
        updateData.license_status = "pending";
      } else if (!isLicensed) {
        updateData.license_status = "none";
      }
    }
    if (typeof isInsured === "boolean") {
      updateData.is_insured = isInsured;
      if (isInsured && insuranceUrl) {
        updateData.insurance_url = insuranceUrl;
        updateData.insurance_status = "pending";
      } else if (!isInsured) {
        updateData.insurance_status = "none";
      }
    }
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

    // Record legal consent. The signup form cannot be submitted without the
    // Terms + Privacy + Platform Rules checkbox, so a successful completion
    // IS the acceptance event — write it to the legal_acceptances audit
    // trail (the table existed but nothing populated it). Versions match
    // the LAST_UPDATED stamps in src/pages/legal/legalSections.ts; bump
    // both places together on a material policy change. Non-fatal: a failed
    // consent write is logged loudly but must not strand a finished signup.
    const { error: legalErr } = await supabase.from("legal_acceptances").insert({
      user_id: userId,
      terms_version: LEGAL_TERMS_VERSION,
      privacy_version: LEGAL_PRIVACY_VERSION,
      ip_address: req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null,
      user_agent: req.headers.get("user-agent") ?? null,
    });
    if (legalErr) {
      console.error(`[complete-signup] legal_acceptances insert failed for ${userId}:`, legalErr);
    }

    // Notify all admins about the new signup (deduped: skip if we already sent one for this user in the last 24h)
    try {
      const { data: profile } = await supabase
        .from("profiles")
        .select("full_name, location")
        .eq("user_id", userId)
        .single();

      const userName = profile?.full_name || "Someone";
      const userLocation = profile?.location ? ` from ${profile.location}` : "";
      const notifMessage = `${userName}${userLocation} just joined. They're auto-approved and can start posting + applying right away.`;

      // Dedupe: skip if an identical notification was sent in the last 24h
      const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
      const { data: existing } = await supabase
        .from("notifications")
        .select("id")
        .eq("title", "👤 New member joined")
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
            title: "👤 New member joined",
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
    return new Response(JSON.stringify({ error: "Internal server error" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
