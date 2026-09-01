import { useEffect, useMemo, useRef, useState } from "react";
import { Navigate, useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { supabase } from "@/integrations/supabase/client";
import { signOutWithPushCleanup } from "@/lib/authSignOut";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { useQueryClient } from "@tanstack/react-query";
import { usePageTitle } from "@/hooks/usePageTitle";
import { toast } from "sonner";
import { Camera, Check, Circle, Loader2, ShieldCheck, X } from "lucide-react";
import { HelprSpinner } from "@/components/ui/HelprSpinner";
import { DatePickerField } from "@/components/DatePickerField";
import { CityAutocomplete } from "@/components/postjob/CityAutocomplete";
import { cn } from "@/lib/utils";
import { isProfileComplete } from "@/components/ProtectedRoute";
import { splitName } from "@/lib/splitName";
import { queryKeys } from "@/lib/queryKeys";
import { unwrapMutationRow, isWriteRejected, mutationErrorMessage } from "@/lib/mutationResult";
import { hapticSuccess, hapticError } from "@/lib/haptics";
import AuthShell from "@/components/auth/AuthShell";
import { uploadProfileFiles } from "./completeProfile/uploadProfileFiles";
import type { ProfileCompletionUpdates } from "./completeProfile/types";
import {
  ALLOWED_IMAGE_TYPES,
  MAX_FILE_SIZE,
  withTimeout,
  formatPhone,
} from "./completeProfile/constants";

const CompleteProfile = () => {
  usePageTitle("Complete Your Profile — Helpr");
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { user, profile, isLoading, refresh } = useCurrentUser();

  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [dateOfBirth, setDateOfBirth] = useState("");
  const [phone, setPhone] = useState("");
  const [location, setLocation] = useState("");
  const [bio, setBio] = useState("");
  // Hydrated from profile.accepted_terms_at on mount so users who already
  // accepted (and were bounced back here for some other missing field, or who
  // simply refreshed the page) don't have to re-tick the box.
  const [acceptedPolicies, setAcceptedPolicies] = useState(false);

  const [avatarFile, setAvatarFile] = useState<File | null>(null);
  const [avatarPreview, setAvatarPreview] = useState<string | null>(null);
  // A remote avatar_url can 404 (a deleted Storage object, a dead dicebear
  // URL). Falling back to the camera placeholder on `onError` is what lets us
  // render the real photo optimistically instead of refusing to render any
  // non-blob: URL at all — see the preview block below.
  const [avatarBroken, setAvatarBroken] = useState(false);

  const [submitting, setSubmitting] = useState(false);

  // Guard against re-running hydration when profile updates (e.g. after a
  // refetch) but user_id is stable. Without this ref the dep-array would need
  // to include every profile field, which risks an infinite re-render loop
  // (setting state inside an effect that depends on state). Once is enough —
  // subsequent profile writes come through the local setState calls.
  const hydratedRef = useRef(false);

  // Hydrate any existing values (so we only ask for what's missing).
  // Only runs the first time a non-null profile is available for this user;
  // each field is also gated by "not already set locally" so a user who has
  // started typing isn't overwritten by a background refetch.
  useEffect(() => {
    if (!profile || hydratedRef.current) return;
    hydratedRef.current = true;
    const { firstName: parsedFirst, lastName: parsedLast } = splitName(profile.full_name);
    if (parsedFirst && !firstName) setFirstName(parsedFirst);
    if (parsedLast && !lastName) setLastName(parsedLast);
    if (profile.date_of_birth && !dateOfBirth) setDateOfBirth(profile.date_of_birth);
    if (profile.phone && !phone) setPhone(formatPhone(profile.phone));
    if (profile.location && !location) setLocation(profile.location);
    if (profile.bio && !bio) setBio(profile.bio);
    // NOTE: avatar_url is deliberately NOT hydrated here. This effect is
    // one-shot (hydratedRef), and the avatar is the one field the gate reads
    // LIVE off `profile.avatar_url` (see `checklist` below). Hydrating it here
    // let the two drift: a profile whose avatar landed after this ran showed
    // "Profile photo * · tap to add" under an ENABLED "Enter App" button —
    // the screen naming a required field as missing while the gate counted it
    // as present. The dedicated effect below keeps them in sync instead.
    // Persisted terms acceptance — read straight from the row so refresh / re-entry
    // doesn't reset the user's previous "yes I agree".
    if (profile.accepted_terms_at) setAcceptedPolicies(true);
  // Intentionally scoped to user_id so a stable user never re-triggers this.
  // The hydratedRef is the real guard; user_id is included to correctly reset
  // the gate when the logged-in user changes (e.g. in a shared-device test).
  }, [profile?.user_id]);

  // Keeps the avatar THUMBNAIL in step with the avatar the GATE reads.
  // A locally-picked file always wins (its blob: URL is the freshest truth);
  // otherwise mirror whatever `profile.avatar_url` currently is, including a
  // value that arrives on a later refetch.
  useEffect(() => {
    if (avatarFile) return;
    const url = profile?.avatar_url ?? null;
    setAvatarPreview((prev) => (prev === url ? prev : url));
    setAvatarBroken(false);
  }, [profile?.avatar_url, avatarFile]);

  const validateFile = (file: File, allowedTypes: string[], label: string): boolean => {
    if (!allowedTypes.includes(file.type)) {
      toast.error(`${label} — that file type isn't supported.`);
      return false;
    }
    if (file.size > MAX_FILE_SIZE) {
      toast.error(`${label} is over 5 MB — try a smaller file.`);
      return false;
    }
    return true;
  };

  const handleAvatarChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file && validateFile(file, ALLOWED_IMAGE_TYPES, "Profile picture")) {
      setAvatarFile(file);
      setAvatarBroken(false);
      setAvatarPreview(URL.createObjectURL(file));
    }
  };

  const ageOk = useMemo(() => {
    if (!dateOfBirth) return false;
    const dob = new Date(dateOfBirth);
    const today = new Date();
    let age = today.getFullYear() - dob.getFullYear();
    const m = today.getMonth() - dob.getMonth();
    if (m < 0 || (m === 0 && today.getDate() < dob.getDate())) age--;
    return age >= 18;
  }, [dateOfBirth]);

  // Live "Big 7" checklist — mirrors ProtectedRoute's gate so the user can
  // see exactly which fields still need attention. Each item is satisfied
  // either by the local form state OR by an existing value already on
  // the profile row (e.g. an avatar uploaded previously).
  const checklist = useMemo(() => {
    const phoneDigits = phone.replace(/\D/g, "");
    return [
      { label: "Full name", done: firstName.trim().length > 0 && lastName.trim().length > 0 },
      { label: "Profile picture", done: Boolean(avatarFile || profile?.avatar_url) },
      { label: "Date of birth (18+)", done: Boolean(dateOfBirth) && ageOk },
      { label: "Phone number", done: phoneDigits.length === 10 },
      { label: "City", done: location.trim().length > 0 },
      // Government-issued ID is intentionally NOT in the required checklist:
      // new signup (SignupStep2) no longer collects it, and identity
      // verification is deferred to first-post / IDV. The upload field below
      // stays available so a user CAN attach it early, but it never blocks
      // profile completion.
      { label: "Accept platform rules, terms & privacy", done: acceptedPolicies },
    ];
  }, [
    firstName,
    lastName,
    avatarFile,
    profile?.avatar_url,
    bio,
    dateOfBirth,
    ageOk,
    phone,
    location,
    acceptedPolicies,
  ]);

  const allComplete = checklist.every((c) => c.done);

  const firstNameValid = firstName.trim().length > 0;
  const lastNameValid = lastName.trim().length > 0;
  const phoneValid = phone.replace(/\D/g, "").length === 10;
  const cityValid = location.trim().length > 0;

  // Same bounds as Signup's DOB picker: today − 18y upper bound (blocks
  // under-18 at the UI layer; the age check below is the backstop), today −
  // 120y floor so the wheel has a sane range.
  const maxDob = (() => {
    const d = new Date();
    d.setFullYear(d.getFullYear() - 18);
    return d.toISOString().split("T")[0];
  })();
  const minDob = (() => {
    const d = new Date();
    d.setFullYear(d.getFullYear() - 120);
    return d.toISOString().split("T")[0];
  })();


  useEffect(() => {
    if (!user?.id || profile || isLoading) return;
    void refresh();
    const retry = window.setInterval(() => void refresh(), 2500);
    return () => window.clearInterval(retry);
     
  }, [user?.id, Boolean(profile), isLoading]);

  const recoverCompletedProfile = async () => {
    if (!user?.id) return false;
    try {
      const { data, error } = await withTimeout(
        Promise.resolve(supabase.from("profiles").select("*").eq("user_id", user.id).maybeSingle()),
        "Profile check",
        12000,
      );
      if (error || !data || !(data.is_legacy_user === true || isProfileComplete(data))) return false;

      queryClient.setQueryData(queryKeys.currentUser.byId(user.id), (current: any) => ({
        ...(current ?? {}),
        profile: data,
        isAdmin: current?.isAdmin ?? false,
      }));
      navigate("/dashboard", { replace: true });
      return true;
    } catch {
      return false;
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user) return;

    const fail = (msg: string) => { hapticError(); toast.error(msg); };
    if (!firstName.trim() || !lastName.trim()) return fail("Add your first and last name.");
    if (!dateOfBirth) return fail("Add your date of birth to continue.");
    if (!ageOk) return fail("You'll need to be 18 or older to join.");
    if (!phone.trim() || phone.replace(/\D/g, "").length < 10) return fail("Add a valid phone number — at least 10 digits.");
    if (!location.trim()) return fail("Tell us your city to continue.");
    if (!avatarFile && !profile?.avatar_url) return fail("Add a profile photo to continue.");
    // Government-issued ID is no longer required here — it's optional at
    // profile completion and deferred to first-post / IDV (matches the
    // signup gate, which stopped collecting it).
    if (!acceptedPolicies) return fail("Check the box to agree to the platform rules and terms.");

    setSubmitting(true);
    try {
      const fullName = `${firstName.trim()} ${lastName.trim()}`;

      // Note: full_name is persisted to the profiles table below. We intentionally
      // skip supabase.auth.updateUser() here because it grabs the auth lock and can
      // collide with the session's autoRefreshToken loop, producing
      // "Acquiring an exclusive Navigator LockManager lock ... lock stolen" errors.

      // Upload files directly to Storage in parallel (much faster than base64-through-edge-function)
      // Government ID upload was removed from this page — Stripe Identity
      // (triggered from the first job post) collects the real ID now, so
      // idFile is always null here.
      const { avatarUrl, idDocumentPath } = await uploadProfileFiles(user.id, avatarFile, null);

      // Single, lightweight DB update — no large JSON over the wire
      const updates: ProfileCompletionUpdates = {
        full_name: fullName,
        phone: phone.trim(),
        bio: bio.trim(),
        location: location.trim(),
        date_of_birth: dateOfBirth,
        // `approval_status: "pending"` used to be sent here. It never did
        // anything for a normal user — the BEFORE UPDATE trigger
        // `tr_prevent_self_escalation` (public.prevent_self_escalation) pins
        // approval_status back to OLD for every non-admin, so the column was
        // written and discarded on every submit. For an ADMIN the trigger
        // returns NEW untouched, so the one account it COULD reach was an
        // admin completing their own profile — demoting themselves to
        // `pending` and locking themselves out of every non-allowPending
        // route. A field the DB refuses to take from this caller does not
        // belong in this caller's payload.
        // Stamp the moment the user accepted the rules / terms / privacy.
        // Persisting this means the checklist won't ask again on refresh.
        accepted_terms_at: new Date().toISOString(),
      };
      if (avatarUrl) updates.avatar_url = avatarUrl;
      if (idDocumentPath) updates.id_document_url = idDocumentPath;

      // Read the persisted row back in the same round-trip. ProtectedRoute's
      // Big-7 completeness gate re-evaluates the instant we navigate to
      // /dashboard, so the cache MUST hold the authoritative saved row — not
      // an optimistic guess that a stale background refetch could clobber.
      //
      // Guarded through unwrapMutation because a null `error` does NOT mean
      // the write happened: an UPDATE matching zero rows (RLS refusing the
      // row, a session whose auth.uid() no longer matches) returns
      // `{ data: [], error: null }`. The previous shape read that as success
      // and fell back to an OPTIMISTIC merge — writing a profile the database
      // does not have into the cache, letting the gate pass, and dropping the
      // user on /dashboard until the next real fetch bounced them back here
      // with nothing to show for the attempt. This is the one write on the
      // screen, and it is the screen's only exit, so a silent rejection has to
      // surface as a failure.
      const savedRow = unwrapMutationRow<Record<string, unknown>>(
        await withTimeout(
          Promise.resolve(
            supabase.from("profiles").update(updates).eq("user_id", user.id).select("*"),
          ),
          "Profile save",
        ),
        {
          action: "save your profile",
          context: { userId: user.id },
        },
      );

      queryClient.setQueryData(queryKeys.currentUser.byId(user.id), (current: any) => ({
        ...(current ?? {}),
        // The row Postgres actually persisted — guaranteed non-null by the
        // guard above.
        profile: savedRow,
        isAdmin: current?.isAdmin ?? false,
      }));
      // No invalidate + sleep here: that triggered a background refetch that
      // could resolve the pre-update row mid-navigation (read-after-write
      // race), failing the completeness gate and bouncing the user straight
      // back to /complete-profile (LH-29). The authoritative row above is the
      // single source of truth; staleTime keeps it from refetching on arrival.
      hapticSuccess();
      navigate("/dashboard", { replace: true });
    } catch (err: any) {
      const recovered = await recoverCompletedProfile();
      if (!recovered) {
        hapticError();
        // A silently-rejected write gets its own sentence (the row wasn't
        // ours / wasn't there); everything else keeps the human fallback so a
        // raw PostgREST code never reaches the one screen a user cannot leave.
        toast.error(
          isWriteRejected(err)
            ? mutationErrorMessage(err)
            : err?.message || "We couldn't save your profile just yet — give it another try.",
        );
      }
    } finally {
      setSubmitting(false);
    }
  };

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-premium-page">
        <HelprSpinner size={24} />
      </div>
    );
  }

  if (user && !profile) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-premium-page px-5">
        <div className="w-full max-w-sm rounded-2xl border border-border/60 bg-card p-6 text-center shadow-[var(--card-shadow)]">
          <div className="flex justify-center mb-4">
            <HelprSpinner size={24} />
          </div>
          <h1 className="text-ds-20 font-display font-bold text-foreground">Checking your saved profile</h1>
          <p className="mt-2 text-ds-11 text-muted-foreground">
            Hang tight — we’re making sure your previous submission is loaded before asking for anything again.
          </p>
          <Button
            type="button"
            variant="outline"
            size="lg"
            onClick={async () => {
              await signOutWithPushCleanup();
              navigate("/login", { replace: true });
            }}
            className="mt-5 w-full rounded-ds-md"
          >
            <X className="w-4 h-4 mr-2" /> Sign Out
          </Button>
        </div>
      </div>
    );
  }

  // Don't trap users who don't actually need this gate. Legacy accounts
  // bypass entirely, and anyone whose profile already satisfies the Big 7
  // gets bounced straight to the dashboard instead of staring at a 0/8
  // checklist they can't dismiss.
  if (profile && (profile.is_legacy_user === true || isProfileComplete(profile))) {
    return <Navigate to="/dashboard" replace />;
  }

  // Migrated from a bespoke wrapper to the shared AuthShell so this screen
  // reads as a sibling of Login / Signup / ForgotPassword / ResetPassword
  // (same wordmark, eyebrow, parchment surface, spacing rhythm). Back is
  // hidden because CompleteProfile is a required post-signup gate — the
  // way out is either Finish or the "Sign out" link at the bottom of the
  // form, not a browser-back that would strand a half-provisioned account.
  // Shell derived from Login.tsx, the canonical focused-auth sibling, rather
  // than assembled here — three defects came out of this one call.
  //
  //  • `noWebChrome` — the marketing Navbar renders a "Dashboard →" pill for
  //    anyone holding a session, and on THIS screen the holder is by
  //    definition half-provisioned: signed in, profile incomplete, sitting in
  //    a required gate. Offering them the dashboard advertises a way around
  //    the gate (owner: "once they sign in it should not reference the
  //    dashboard until they are fully signed up"). It drops the Footer too,
  //    which is right for the same reason Login drops it — this is a flow, not
  //    a landing page.
  //  • `hideHeader` — removes the "Helpr · LA" wordmark and the
  //    "Louisiana's Local Job Partner" eyebrow. The page already has its own
  //    "Almost there." heading, so the brand block was a second, competing
  //    title on a screen whose whole job is one form (owner).
  //  • `centerColumn` + the wider measure — `align` defaults to "start", so
  //    `items-start` pinned the max-w-md (448px) column against the left edge:
  //    at 1534 the content ran 48→496 with 1038px dead to the right, centre
  //    272 against a viewport centre of 767. CLAUDE.md calls that a hard
  //    failure ("a page that floats in a lopsided column with blank bands has
  //    failed the audit"), and it is what the owner was pointing at.
  return (
    <AuthShell hideBack hideHeader centerColumn maxWidth="lg" noWebChrome>
      <div className="pb-12">
          <div className="text-center mb-7">
            <span className="text-display-eyebrow">Welcome aboard</span>
            <h1
              className="font-display italic font-bold leading-tight mt-2"
              style={{
                fontSize: "clamp(2rem, 4vw + 0.5rem, 2.75rem)",
                color: "hsl(var(--ink-deep))",
                letterSpacing: "-0.025em",
              }}
            >
              Almost there.
            </h1>
            <p className="mt-3 font-serif italic text-ds-13" style={{ color: "hsl(var(--olivewood) / 0.8)" }}>
              We need a few details before you can use Helpr. This keeps the community safe.
            </p>
          </div>

          <form
            onSubmit={handleSubmit}
            className="rounded-2xl border border-border/60 bg-card shadow-[var(--card-shadow)] p-6 sm:p-7 space-y-5"
          >
            {/* Always shown, pre-filled when already known (an email signup
                already has this from SignupStep2; Google/Apple never
                collected it) — so the person can double-check what came
                over from the provider instead of it disappearing silently. */}
            <div className="flex flex-col items-center gap-2 -mt-1">
              <label
                htmlFor="avatar"
                className="group relative cursor-pointer"
                aria-label={avatarPreview ? "Change profile picture" : "Upload profile picture"}
              >
                <div className="w-24 h-24 rounded-full overflow-hidden ring-2 ring-border bg-muted flex items-center justify-center transition-all group-hover:ring-primary/50">
                  {/* Renders ANY preview URL, not just a freshly-picked
                      `blob:`. The old `startsWith("blob:")` guard meant a user
                      who already had an avatar on file saw an empty camera
                      placeholder under the caption "Tap to change" — the
                      screen implying the photo was missing on the one screen
                      that will not let them leave until it isn't. A remote URL
                      that 404s falls back to the placeholder via onError. */}
                  {avatarPreview && !avatarBroken ? (
                    <img
                      loading="lazy"
                      decoding="async"
                      src={avatarPreview}
                      alt="Profile preview"
                      className="w-full h-full object-cover"
                      onError={() => setAvatarBroken(true)}
                    />
                  ) : (
                    <Camera className="w-7 h-7 text-muted-foreground" />
                  )}
                </div>
                <div className="absolute bottom-0 right-0 w-7 h-7 rounded-full bg-primary text-primary-foreground flex items-center justify-center shadow-md ring-2 ring-card">
                  <Camera className="w-3.5 h-3.5" />
                </div>
                <input
                  id="avatar"
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={handleAvatarChange}
                />
              </label>
              <p className="text-ds-11 text-muted-foreground">
                {avatarPreview && !avatarBroken
                  ? "Tap to change · JPG, PNG, WebP (5MB max)"
                  : <>Profile photo <span className="text-destructive">*</span> · tap to add</>}
              </p>
            </div>

            {/* Same as above: pre-filled and editable, never hidden — Google
                usually returns a name, Apple often doesn't, so this is the
                one chance to catch a wrong or missing name either way. */}
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="firstName">First name <span className="text-destructive">*</span></Label>
                <div className="relative">
                  <Input
                    id="firstName"
                    autoComplete="given-name"
                    autoCapitalize="words"
                    value={firstName}
                    onChange={(e) => setFirstName(e.target.value)}
                    className={`rounded-ds-md ${firstNameValid ? "pr-10" : ""}`}
                  />
                  {firstNameValid && (
                    <Check className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-primary pointer-events-none" strokeWidth={2.5} aria-hidden />
                  )}
                </div>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="lastName">Last name <span className="text-destructive">*</span></Label>
                <div className="relative">
                  <Input
                    id="lastName"
                    autoComplete="family-name"
                    autoCapitalize="words"
                    value={lastName}
                    onChange={(e) => setLastName(e.target.value)}
                    className={`rounded-ds-md ${lastNameValid ? "pr-10" : ""}`}
                  />
                  {lastNameValid && (
                    <Check className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-primary pointer-events-none" strokeWidth={2.5} aria-hidden />
                  )}
                </div>
              </div>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="dob">Date of birth (must be 18+) <span className="text-destructive">*</span></Label>
              {/* Same shared DatePickerField as Signup's DOB field (tap-to-open
                  wheel, checkmark once a valid date is picked) — was a
                  separate three-Select picker here, reading as a different
                  control for the same kind of field. */}
              <DatePickerField
                wheel
                showCompleteCheck
                id="dob"
                value={dateOfBirth}
                onChange={setDateOfBirth}
                min={minDob}
                max={maxDob}
                className="rounded-ds-md"
              />
              {dateOfBirth && !ageOk && (
                <p className="text-ds-11 text-destructive">You'll need to be 18 or older to join Helpr.</p>
              )}
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="phone">Phone <span className="text-destructive">*</span></Label>
              <div className="relative">
                <Input
                  id="phone"
                  type="tel"
                  inputMode="tel"
                  autoComplete="tel"
                  maxLength={14}
                  value={phone}
                  onChange={(e) => setPhone(formatPhone(e.target.value))}
                  className={`rounded-ds-md ${phoneValid ? "pr-10" : ""}`}
                />
                {phoneValid && (
                  <Check className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-primary pointer-events-none" strokeWidth={2.5} aria-hidden />
                )}
              </div>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="city">City <span className="text-destructive">*</span></Label>
              {/* CityAutocomplete is the same combobox used on the
                  Post-a-Task form. It nudges the user toward canonical
                  Louisiana spellings (the LOUISIANA_CITIES bundle) but
                  still accepts a free-typed value for tiny communities
                  not on the list, so the form never traps anyone. */}
              <div className="relative">
                <CityAutocomplete
                  id="city"
                  value={location}
                  onChange={setLocation}
                  className={`rounded-ds-md ${cityValid ? "pr-10" : ""}`}
                />
                {cityValid && (
                  <Check className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-primary pointer-events-none z-10" strokeWidth={2.5} aria-hidden />
                )}
              </div>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="bio">About you <span className="font-normal" style={{ color: "hsl(var(--olivewood) / 0.7)" }}>(optional)</span></Label>
              <Textarea
                id="bio"
                rows={3}
                placeholder="A short intro neighbors will see on your profile."
                value={bio}
                onChange={(e) => setBio(e.target.value)}
                autoCapitalize="sentences"
                className="rounded-ds-md"
              />
              <p className="text-ds-11" style={{ color: "hsl(var(--olivewood) / 0.8)" }}>
                You can always add this later from your profile.
              </p>
            </div>

            {/* aria-labelledby, NOT the wrapping <label> alone — same reason
                as SignupStep1's consent row: Radix renders Checkbox as
                <button role="checkbox"> with empty content, so the box
                announced as an unnamed checkbox while the user was agreeing to
                the rules, terms and privacy policy. */}
            <label htmlFor="accept-policies" className="flex items-start gap-2.5 text-ds-11 cursor-pointer" style={{ color: "hsl(var(--olivewood) / 0.8)" }}>
              <Checkbox
                id="accept-policies"
                aria-labelledby="accept-policies-label"
                checked={acceptedPolicies}
                onCheckedChange={(v) => setAcceptedPolicies(v === true)}
                className="h-3.5 w-3.5 mt-[3px] shrink-0 [&_svg]:h-3 [&_svg]:w-3"
              />
              <span id="accept-policies-label" className="leading-relaxed">
                {/* Wording/order matches SignupStep1's identical consent row
                    (Terms, Rules & Privacy) so the same box reads the same
                    way everywhere a user ticks it. */}
                I agree to the{" "}
                <a href="/terms" target="_blank" rel="noreferrer" className="font-semibold hover:underline" style={{ color: "hsl(var(--bark))" }}>Terms</a>,{" "}
                <a href="/rules" target="_blank" rel="noreferrer" className="font-semibold hover:underline" style={{ color: "hsl(var(--bark))" }}>Rules</a>{" & "}
                <a href="/privacy" target="_blank" rel="noreferrer" className="font-semibold hover:underline" style={{ color: "hsl(var(--bark))" }}>Privacy</a>. <span style={{ color: "hsl(var(--burnt-sienna))" }}>*</span>
              </span>
            </label>

            {/* WHAT IS STILL MISSING — the whole point of this screen.
                The `checklist` above has existed since the gate shipped and was
                never rendered: the only signal a blocked user got was a
                DISABLED button reading "Complete Required Fields", with every
                field on the form wearing an identical red asterisk whether it
                was satisfied or not. Because the button is disabled whenever
                `allComplete` is false, the per-field `fail()` toasts in
                handleSubmit are unreachable too — so a user missing exactly one
                field (four accounts in prod on 2026-08-31, two of them missing
                only City) had nothing anywhere on the page naming it.
                This is a redirect the app will not let them out of, so naming
                the remaining fields is not a nicety.
                Shown only while incomplete: once every item is done the list
                is noise and the enabled "Enter App" button says it better. */}
            {!allComplete && (
              <div
                className="rounded-ds-md border p-3.5"
                style={{
                  borderColor: "hsl(var(--burnt-sienna) / 0.28)",
                  background: "hsl(var(--burnt-sienna) / 0.06)",
                }}
              >
                {/* NOT `text-display-eyebrow` — that utility is `display: none`
                    app-wide (index.css, the 2026-07-25 "all eyebrows gone"
                    decision), so a label written with it renders nothing.
                    Caught here by reading the computed page text, not the
                    class name — same trap as asserting gloss by class. */}
                <p className="text-ds-11 font-semibold" style={{ color: "hsl(var(--burnt-sienna))" }}>
                  Still needed
                </p>
                <ul className="mt-2 space-y-1.5" aria-live="polite">
                  {checklist
                    .filter((c) => !c.done)
                    .map((c) => (
                      <li key={c.label} className="flex items-center gap-2 text-ds-11" style={{ color: "hsl(var(--ink-deep))" }}>
                        <Circle className="w-3 h-3 shrink-0" strokeWidth={2.5} style={{ color: "hsl(var(--burnt-sienna) / 0.7)" }} aria-hidden />
                        {c.label}
                      </li>
                    ))}
                </ul>
                {checklist.some((c) => c.done) && (
                  <p className="mt-2.5 text-ds-11" style={{ color: "hsl(var(--olivewood) / 0.8)" }}>
                    {checklist.filter((c) => c.done).length} of {checklist.length} done.
                  </p>
                )}
              </div>
            )}

            <Button
              type="submit"
              size="lg"
              className={cn(
                "w-full rounded-ds-md",
                allComplete && !submitting && "btn-grad-primary",
              )}
              disabled={submitting || !allComplete}
            >
              {submitting ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <ShieldCheck className="w-4 h-4 mr-2" />}
              {submitting ? "Saving…" : allComplete ? "Enter App" : "Complete Required Fields"}
            </Button>

            <Button
              type="button"
              variant="outline"
              size="lg"
              onClick={async () => {
                await signOutWithPushCleanup();
                navigate("/login", { replace: true });
              }}
              className="w-full rounded-ds-md"
            >
              <X className="w-4 h-4 mr-2" /> Sign Out
            </Button>

            {/* The only route to a human from inside the gate. ProtectedRoute's
                PROFILE_GATE_ALLOWED set lets a half-onboarded user reach
                /support, /terms, /rules, /privacy and /profile?tab=legal — but
                until now this screen linked to four of those five and never to
                support, so the escape hatch existed and was invisible. Someone
                stuck on a field they cannot satisfy (a phone number the format
                rejects, a city not in the list) had "Sign Out" as their only
                other affordance. /help is NOT on the allowed list, so link
                /support, which is. */}
            <p className="text-center text-ds-11" style={{ color: "hsl(var(--olivewood) / 0.8)" }}>
              Stuck on something?{" "}
              <a href="/support" className="font-semibold hover:underline" style={{ color: "hsl(var(--bark))" }}>
                Contact support
              </a>
            </p>
          </form>
      </div>
    </AuthShell>
  );
};

export default CompleteProfile;
