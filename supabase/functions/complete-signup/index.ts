import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { checkRateLimit, rateLimitResponse } from "../_shared/rate-limit.ts";
import { LEGAL_TERMS_VERSION, LEGAL_PRIVACY_VERSION } from "../_shared/legalVersions.ts";
import {
  avatarObjectKey,
  resolveAvatarContentType,
  safeDocumentExt,
  sweepSupersededAvatars,
} from "../_shared/storageKeys.ts";

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
      marketingConsent,
      // Explicit "I am 18 or older" attestation from the signup form. DOB is
      // deferred at signup, so this checkbox is what satisfies the legal age
      // gate on the initial path (see the 18+ gate below).
      ageAttested,
      // Explicit "I agree to the Terms, Privacy Policy and Platform Rules"
      // attestation. The tick is a hard client gate, but recording the
      // assertion the user actually made beats inferring consent from the
      // arrival of a request. Optional on the wire so an already-shipped iOS
      // build (whose JS is bundled into the .ipa and cannot be updated from
      // here) does not start failing signup — `null` means "this client is
      // older than the field", not "the user declined".
      termsAccepted,
      // `?ref=<code>` from a referral share link, forwarded by Signup.tsx.
      // See the referral block near the bottom of this function for why it is
      // recorded here rather than by the client.
      referralCode,
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
      // Separate "lookup failed" from "no such profile". Dropping the error
      // collapsed both into the 404 branch, which on this UNAUTHENTICATED path
      // meant a transient DB failure bypassed the "already completed — please
      // log in" guard above and let the completion proceed.
      const { data: existingProfile, error: existingProfileError } = await supabase
        .from("profiles")
        .select("bio, approval_status")
        .eq("user_id", bodyUserId)
        .single();

      if (existingProfileError && existingProfileError.code !== "PGRST116") {
        console.error("[complete-signup] profile lookup failed:", existingProfileError.message);
        return new Response(JSON.stringify({ error: "We couldn't load your account. Please try again." }), {
          status: 503,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

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
    // Superseded avatar objects the sweep could NOT confirm are gone. Returned
    // to the caller rather than only logged, so a still-public previous photo
    // is something the app can surface to the person whose photo it is.
    let staleAvatarObjects: string[] = [];
    let idDocumentUrl: string | null = null;
    let licenseUrl: string | null = null;
    let insuranceUrl: string | null = null;
    const portfolioUrls: string[] = [];

    // 1. Upload avatar to the dedicated public `avatars` bucket
    // (was incorrectly using job-photos before — bucket got created
    // 2026-05-05 alongside making user-documents private).
    //
    // The key is DERIVED from the content type by `../_shared/avatarKey.ts`;
    // `avatarExt` is no longer interpolated into it. It used to be, and because
    // this function holds the SERVICE ROLE key there was no storage RLS to
    // catch it: `avatarExt: "png/../../<victim>/avatar.png"` overwrote another
    // account's public profile photo, verified against prod. Every detail and
    // the three reproductions are in that file's header.
    if (avatarBase64) {
      const resolvedType = resolveAvatarContentType(avatarContentType, avatarExt);
      if (!resolvedType) {
        // A permanent property of the file, not a transient failure — so it
        // must NOT fall through to the "couldn't save it, try again" 502
        // below, which would send the user round a loop that cannot succeed.
        return new Response(
          JSON.stringify({
            error:
              "That file type isn't supported for a profile photo — use JPG, PNG, WebP or GIF.",
          }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      const avatarPath = avatarObjectKey(userId, resolvedType);
      const avatarBytes = Uint8Array.from(atob(avatarBase64), (c) => c.charCodeAt(0));
      const { error: avatarErr } = await supabase.storage
        .from("avatars")
        .upload(avatarPath, avatarBytes, {
          contentType: resolvedType,
          upsert: true,
        });

      if (avatarErr) {
        console.error("Avatar upload error:", avatarErr);
      } else {
        const { data: urlData } = supabase.storage.from("avatars").getPublicUrl(avatarPath);
        avatarUrl = urlData.publicUrl;

        // Delete any `avatar.*` sibling left by a different format (or by the
        // old client-controlled key scheme) and PROVE it by re-listing. Never
        // throws: the new photo is already live, and failing here would leave
        // the profile pointing at the object being replaced.
        const { staleRemaining } = await sweepSupersededAvatars(
          supabase,
          userId,
          avatarPath.slice(userId.length + 1),
        );
        if (staleRemaining.length > 0) {
          staleAvatarObjects = staleRemaining;
          console.error(
            `[complete-signup] ${staleRemaining.length} superseded avatar object(s) still public for ${userId}: ${staleRemaining.join(", ")}`,
          );
        }
      }
    }

    // 2. Upload ID document
    //
    // `idExt` is no longer interpolated into the key — see
    // `../_shared/storageKeys.ts`. Being a PRIVATE bucket was never the
    // mitigation it looks like: `idExt: "png/../../<victim>/id-document.png"`
    // planted a file under another member's folder, and that is precisely the
    // object an admin reviewer opens as that member's government ID. The bucket
    // also declares no allowed_mime_types and no size limit, so nothing below
    // this line was checking either.
    if (idBase64) {
      const idPath = `${userId}/id-document.${safeDocumentExt(idContentType, idExt)}`;
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
    if (licenseBase64) {
      const licensePath = `${userId}/credentials/license-${Date.now()}.${safeDocumentExt(licenseContentType, licenseExt)}`;
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
    if (insuranceBase64) {
      const insurancePath = `${userId}/credentials/insurance-${Date.now()}.${safeDocumentExt(insuranceContentType, insuranceExt)}`;
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
        // A FIFTH site of the same defect, not in the original report: `file.ext`
        // is an element of a client-supplied array, interpolated straight into
        // the key. Same treatment as the three above.
        const path = `${userId}/${Date.now()}-${Math.random().toString(36).slice(2)}.${safeDocumentExt(file.contentType, file.ext)}`;
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
    // `avatarExt` is no longer part of the condition: it is not required to
    // store the file any more, so keeping it here would have let a client that
    // omits it upload nothing and still be told the signup succeeded.
    if (avatarBase64 && !avatarUrl) uploadFailures.push("profile picture");
    if (idBase64 && !idDocumentUrl) uploadFailures.push("ID document");
    if (licenseBase64 && !licenseUrl) uploadFailures.push("license");
    if (insuranceBase64 && !insuranceUrl) uploadFailures.push("insurance document");
    if (uploadFailures.length > 0) {
      return new Response(
        JSON.stringify({ error: `We couldn't save your ${uploadFailures.join(", ")}. Please try again.` }),
        { status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // 4. Check current profile to determine if this is a resubmission
    // Fail closed, matching the lookup at :125. This row feeds BOTH the 18+
    // gate below (via currentProfile.date_of_birth) and the resubmission ID
    // requirement. Dropping the error degraded the legal age gate to
    // attestation-only: a caller who omits dateOfBirth and sends
    // ageAttested:true would skip the stored DOB entirely, so a profile with a
    // known under-18 DOB could pass a check that exists to stop exactly that.
    // PGRST116 (no row yet) stays a legitimate initial-completion path.
    const { data: currentProfile, error: currentProfileError } = await supabase
      .from("profiles")
      .select("approval_status, application_count, date_of_birth")
      .eq("user_id", userId)
      .single();

    if (currentProfileError && currentProfileError.code !== "PGRST116") {
      console.error("[complete-signup] profile lookup failed:", currentProfileError.message);
      return new Response(
        JSON.stringify({ error: "We couldn't load your account. Please try again." }),
        { status: 503, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const isResubmission = currentProfile?.approval_status === "denied";

    // 4b. Server-side 18+ gate — a legal requirement on a real-money platform,
    // so it must be enforced here, not just client-side.
    //
    // DOB is DEFERRED at signup (collected later on first post/apply), so an
    // initial completion legitimately arrives with NO date_of_birth. In that
    // case the gate is satisfied by the explicit 18+ attestation checkbox the
    // signup form now forces (ageAttested). When a DOB *is* present (a
    // resubmission, or a user who filled it in), we still hard-validate that
    // it's a real date and ≥18. A direct API call that skips the form — no DOB
    // AND no attestation — is refused, so we never auto-approve an account with
    // no proof of age.
    const effectiveDob: string | null = dateOfBirth || currentProfile?.date_of_birth || null;
    if (effectiveDob) {
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
    } else if (ageAttested !== true) {
      return new Response(
        JSON.stringify({ error: "You must confirm you are at least 18 years old to use Helpr." }),
        { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // The ID document is resubmission-only — initial signup collects no ID
    // (Stripe IDV handles identity later), so it must NOT be required on the
    // initial path or it would reject real signups. avatar/bio/phone/location
    // are DEFERRED at signup (soft-prompted later on first post/apply), so they
    // are intentionally NOT required here either: the client never sends them
    // on the initial completion, and hard-requiring them rejected every real
    // signup — leaving an orphaned auth row with no completable profile.
    const missing: string[] = [];
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
    // Explicit marketing-email consent captured at signup. Only apply when
    // the client sent the field (undefined → leave server default false in
    // place, don't accidentally reset an already-consented row to false).
    if (typeof marketingConsent === "boolean") updateData.marketing_consent = marketingConsent;
    // Version-pin the accepted Terms so a future material change to the
    // policy triggers the re-consent modal (see TermsReconsentDialog). The
    // policies checkbox in SignupStep1 is a hard requirement to reach this
    // path, so recording it here IS the affirmative acceptance.
    //
    // THREE columns, three different questions, and they used to be answered
    // by three unrelated writers:
    //   terms_version_accepted — which version they are on (drives re-consent)
    //   terms_accepted_at      — when they accepted THAT version (re-stamped)
    //   accepted_terms_at      — the FIRST time they ever accepted (immutable)
    // `accepted_terms_at` was written only by CompleteProfile.tsx and this
    // function only wrote the other two, so prod ended up with 12/30 profiles
    // missing one and 22/30 missing the other. Both are written here now, and
    // `tr_preserve_first_consent` (migration 20260901035252) pins
    // `accepted_terms_at` to its existing value, so re-running this function
    // on a resubmission re-stamps the version timestamp without destroying the
    // original consent. Sending it unconditionally is deliberate: the database
    // owns "first wins", so no caller has to read-then-write and race.
    const consentAt = new Date().toISOString();
    updateData.terms_version_accepted = LEGAL_TERMS_VERSION;
    updateData.terms_accepted_at = consentAt;
    updateData.accepted_terms_at = consentAt;
    if (availability) updateData.availability = availability;
    if (transportation) updateData.transportation = transportation;
    if (hearAboutUs) updateData.hear_about_us = hearAboutUs;
    if (experienceLevel) updateData.experience_level = experienceLevel;
    if (toolsEquipment) updateData.tools_equipment = toolsEquipment;
    if (emergencyContactName) updateData.emergency_contact_name = emergencyContactName;
    if (emergencyContactPhone) updateData.emergency_contact_phone = emergencyContactPhone;
    if (jobRadius) updateData.job_radius = jobRadius;
    if (extraComments) updateData.extra_comments = extraComments;

    // `.select("user_id")` + a zero-row branch, per CLAUDE.md. This UPDATE is
    // what sets `approval_status: "approved"` (line 397) — it is the write that
    // decides whether the account can post or apply at all — and an UPDATE
    // matching zero rows returns `{ data: [], error: null }`, indistinguishable
    // from success.
    //
    // Zero rows is genuinely reachable here, not theoretical: on the JWT path
    // the profile read at :323-335 deliberately tolerates PGRST116 ("no profile
    // row yet"), so execution arrives here with no proof a row exists. Without
    // the guard the function answered `success: true` and Signup.tsx treated
    // the account as finished, leaving the user stranded unapproved with no
    // error surfaced anywhere.
    const { data: updatedRows, error: profileErr } = await supabase
      .from("profiles")
      .update(updateData)
      .eq("user_id", userId)
      .select("user_id");

    if (profileErr || (updatedRows?.length ?? 0) === 0) {
      console.error(
        "Profile update error:",
        profileErr ?? `zero rows matched for user_id ${userId} — profile row missing, account left unapproved`,
      );
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
    //
    // `marketing_opted_in` is now populated. The column has existed since the
    // table was created and was never written, so every row in the audit trail
    // said the user had NOT opted into marketing — including the rows for
    // users who ticked the box. The value the sender actually filters on lives
    // in `profiles.marketing_consent` (written above), so nothing mis-mailed;
    // but the record that is supposed to EVIDENCE the opt-in disagreed with
    // it, which is worse than leaving the column out of the schema.
    const { error: legalErr } = await supabase.from("legal_acceptances").insert({
      user_id: userId,
      terms_version: LEGAL_TERMS_VERSION,
      privacy_version: LEGAL_PRIVACY_VERSION,
      marketing_opted_in: marketingConsent === true,
      ip_address: req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null,
      user_agent: req.headers.get("user-agent") ?? null,
    });
    if (legalErr) {
      console.error(`[complete-signup] legal_acceptances insert failed for ${userId}:`, legalErr);
    }
    // An older shipped client that does not send the field yields `null`, which
    // is "unknown", not "declined" — the tick is still a hard gate in the form.
    // Logged so the tail of pre-update builds is visible rather than assumed.
    if (termsAccepted !== true) {
      console.warn(
        `[complete-signup] no explicit termsAccepted from client for ${userId} (got ${JSON.stringify(termsAccepted)}); consent recorded from completion`,
      );
    }

    // Record the referral, if this signup came in through a `?ref=` link.
    //
    // THIS IS THE ONLY PLACE IT CAN HAPPEN. `process_referral` requires
    // `auth.uid() = p_new_user_id` (hardened 2026-08-19) and is granted to
    // `authenticated` only, but the client calls it moments after
    // `auth.signUp` — which returns no session while email confirmation is on.
    // So the client call was 401 `42501 permission denied` 100% of the time,
    // and prod has 29 referral codes against 0 referrals to show for it.
    //
    // This function is the right home: it has already proved the caller owns
    // `userId` (a 30-minute window from account creation + never-signed-in +
    // an empty profile, or a valid JWT), and it runs service-role, so it needs
    // no session. It deliberately does NOT call `process_referral` — under
    // service-role `auth.uid()` is NULL, which that function correctly rejects
    // as `not_authorized`. It calls `record_referral_signup`, the shared body
    // behind both entry points, granted to service_role only.
    //
    // Best-effort by design: a referral is a bonus, and failing a completed
    // signup over one would trade a $5 credit for an orphaned account. But the
    // error is never dropped — a silently-failing referral path is the exact
    // bug being fixed here, and it stayed invisible for months.
    let referralRecorded = false;
    if (typeof referralCode === "string" && referralCode.trim()) {
      const { data: referralOk, error: referralErr } = await supabase.rpc("record_referral_signup", {
        p_referral_code: referralCode.trim().toUpperCase(),
        p_new_user_id: userId,
      });
      if (referralErr) {
        // PGRST202 means the RPC is not in the schema cache yet — this
        // function deploys on push while the migration deploys on merge, so
        // there is a window where the code is live and the function is not.
        // Distinguished in the log so the deploy-lag case is not investigated
        // as a permissions or data bug.
        const code = (referralErr as { code?: string }).code;
        console.error(
          `[complete-signup] referral not recorded for ${userId} (code ${referralCode.trim().toUpperCase()})${
            code === "PGRST202" ? " — record_referral_signup not deployed yet (migration lag)" : ""
          }:`,
          referralErr.message ?? referralErr,
        );
      } else {
        // The RPC returns FALSE for an unknown code, a self-referral, or a
        // user who was already referred — all legitimate no-ops, not errors.
        referralRecorded = referralOk === true;
        if (!referralRecorded) {
          console.log(
            `[complete-signup] referral code ${referralCode.trim().toUpperCase()} did not apply to ${userId} (unknown code, self-referral, or already referred)`,
          );
        }
      }
    }

    // Notify all admins about the new signup (deduped: skip if we already sent one for this user in the last 24h)
    try {
      const { data: profile } = await supabase
        .from("profiles")
        .select("full_name, location")
        .eq("user_id", userId)
        .single();

      // ONE definition, read by both the dedupe query and the insert. Two
      // hand-written copies of this string is what made the dedupe dead.
      const NEW_MEMBER_TITLE = "New member joined";
      const userName = profile?.full_name || "Someone";
      const userLocation = profile?.location ? ` from ${profile.location}` : "";
      const notifMessage = `${userName}${userLocation} just joined. They're auto-approved and can start posting + applying right away.`;

      // Dedupe: skip if an identical notification was sent in the last 24h.
      //
      // The title on BOTH sides comes from one constant now. It did not: the
      // query asked for "👤 New member joined" (with the emoji) while the
      // insert below wrote "New member joined" (without), so the two could
      // never match and the dedupe was dead from the day the emoji was
      // dropped. Verified against prod 2026-08-31: 88 notification rows carry
      // the plain title and ZERO carry the emoji one, and those 88 rows hold
      // only 6 distinct messages — one repeated 26 times.
      //
      // A failed dedupe READ must fail CLOSED (skip the fan-out) rather than
      // default to sending: `!existing?.length` treated a read error as "no
      // prior notification", which is the same shape that re-mailed the cohort.
      const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
      const { data: existing, error: existingErr } = await supabase
        .from("notifications")
        .select("id")
        .eq("title", NEW_MEMBER_TITLE)
        .eq("message", notifMessage)
        .gte("created_at", since)
        .limit(1);
      if (existingErr) {
        console.error("[complete-signup] admin-notify dedupe read failed; skipping fan-out:", existingErr.message);
      } else if (!existing?.length) {
        const { data: admins, error: adminsErr } = await supabase
          .from("user_roles")
          .select("user_id")
          .eq("role", "admin");
        if (adminsErr) {
          console.error("[complete-signup] admin lookup failed; no admin was told about this signup:", adminsErr.message);
        } else if (admins?.length) {
          const adminNotifs = admins.map((admin: { user_id: string }) => ({
            user_id: admin.user_id,
            title: NEW_MEMBER_TITLE,
            message: notifMessage,
            // `?view=people&user=<id>` — the id-bearing deep link Admin.tsx:47
            // actually reads (`searchParams.get("view")`, and the View union
            // spells it `people`, not `users`). A bare "/admin" made the
            // reviewer hunt for the account the notification is about.
            type: "info",
            link: `/admin?view=people&user=${userId}`,
          }));

          // PostgREST resolves with `{ error }`; it does not throw, so the
          // enclosing try/catch could never see a failed insert. Read the
          // error off the result.
          const { error: notifInsertErr } = await supabase.from("notifications").insert(adminNotifs);
          if (notifInsertErr) {
            console.error("[complete-signup] admin notification insert failed:", notifInsertErr.message);
          }
        }
      }
    } catch (notifErr) {
      console.error("Failed to notify admins:", notifErr);
    }

    return new Response(
      JSON.stringify({
        success: true,
        avatarUrl,
        idDocumentUrl,
        portfolioUrls,
        referralRecorded,
        // Empty on the normal path. Non-empty means a previous profile photo is
        // STILL publicly fetchable — see `../_shared/avatarKey.ts`.
        staleAvatarObjects,
      }),
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
