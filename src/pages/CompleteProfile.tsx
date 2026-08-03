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
import { Camera, Check, FileText, Loader2, ShieldCheck, X } from "lucide-react";
import { HelprSpinner } from "@/components/ui/HelprSpinner";
import { DateOfBirthPicker } from "@/components/DateOfBirthPicker";
import { CityAutocomplete } from "@/components/postjob/CityAutocomplete";
import { cn } from "@/lib/utils";
import { isProfileComplete } from "@/components/ProtectedRoute";
import { splitName } from "@/lib/splitName";
import { queryKeys } from "@/lib/queryKeys";
import { hapticSuccess, hapticError } from "@/lib/haptics";
import AuthShell from "@/components/auth/AuthShell";
import { ChecklistCard } from "./completeProfile/ChecklistCard";
import { uploadProfileFiles } from "./completeProfile/uploadProfileFiles";
import type { ProfileCompletionUpdates } from "./completeProfile/types";
import {
  ALLOWED_IMAGE_TYPES,
  ALLOWED_DOC_TYPES,
  MAX_FILE_SIZE,
  withTimeout,
  formatPhone,
} from "./completeProfile/constants";

const CompleteProfile = () => {
  usePageTitle("Complete your profile — Helpr");
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
  const [idFile, setIdFile] = useState<File | null>(null);
  const [idPreview, setIdPreview] = useState<string | null>(null);

  const [submitting, setSubmitting] = useState(false);
  // On small viewports (SE ≤375px) the checklist is collapsed by default to
  // reduce scroll distance; tapping the header expands it. On larger screens
  // (sm+) it's always visible. Starts collapsed so the form is reachable quickly.
  const [checklistExpanded, setChecklistExpanded] = useState(false);

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
    if (profile.avatar_url && !avatarPreview) setAvatarPreview(profile.avatar_url);
    if (profile.id_document_url && !idPreview) setIdPreview(profile.id_document_url);
    // Persisted terms acceptance — read straight from the row so refresh / re-entry
    // doesn't reset the user's previous "yes I agree".
    if (profile.accepted_terms_at) setAcceptedPolicies(true);
  // Intentionally scoped to user_id so a stable user never re-triggers this.
  // The hydratedRef is the real guard; user_id is included to correctly reset
  // the gate when the logged-in user changes (e.g. in a shared-device test).
  }, [profile?.user_id]);

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
      setAvatarPreview(URL.createObjectURL(file));
    }
  };

  const handleIdChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file && validateFile(file, ALLOWED_DOC_TYPES, "ID document")) {
      setIdFile(file);
      setIdPreview(file.type.startsWith("image/") ? URL.createObjectURL(file) : null);
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
      { label: "About you (20+ characters)", done: bio.trim().length >= 20 },
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
      toast.success("Your profile was already saved — opening Helpr.");
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
    if (!firstName.trim() || !lastName.trim()) return fail("Please enter your full name");
    if (!dateOfBirth) return fail("Date of birth is required");
    if (!ageOk) return fail("You'll need to be 18 or older to join.");
    if (!phone.trim() || phone.replace(/\D/g, "").length < 10) return fail("Valid phone number is required");
    if (!location.trim()) return fail("City is required");
    if (!bio.trim() || bio.trim().length < 20) return fail("Tell us a little about yourself — at least 20 characters.");
    if (!avatarFile && !profile?.avatar_url) return fail("Profile picture is required");
    // Government-issued ID is no longer required here — it's optional at
    // profile completion and deferred to first-post / IDV (matches the
    // signup gate, which stopped collecting it).
    if (!acceptedPolicies) return fail("Please accept the platform rules, terms, and privacy policy");

    setSubmitting(true);
    try {
      const fullName = `${firstName.trim()} ${lastName.trim()}`;

      // Note: full_name is persisted to the profiles table below. We intentionally
      // skip supabase.auth.updateUser() here because it grabs the auth lock and can
      // collide with the session's autoRefreshToken loop, producing
      // "Acquiring an exclusive Navigator LockManager lock ... lock stolen" errors.

      // Upload files directly to Storage in parallel (much faster than base64-through-edge-function)
      const { avatarUrl, idDocumentPath } = await uploadProfileFiles(user.id, avatarFile, idFile);

      // Single, lightweight DB update — no large JSON over the wire
      const updates: ProfileCompletionUpdates = {
        full_name: fullName,
        phone: phone.trim(),
        bio: bio.trim(),
        location: location.trim(),
        date_of_birth: dateOfBirth,
        approval_status: "pending",
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
      const { data: savedRow, error: updateErr } = await withTimeout(
        Promise.resolve(
          supabase.from("profiles").update(updates).eq("user_id", user.id).select("*").maybeSingle(),
        ),
        "Profile save",
      );
      if (updateErr) throw updateErr;

      queryClient.setQueryData(queryKeys.currentUser.byId(user.id), (current: any) => ({
        ...(current ?? {}),
        // Prefer the row Postgres actually persisted; fall back to a merged
        // optimistic shape only if the read-back came back empty.
        profile: savedRow ?? {
          ...(current?.profile ?? profile ?? {}),
          ...updates,
          user_id: user.id,
        },
        isAdmin: current?.isAdmin ?? false,
      }));
      // No invalidate + sleep here: that triggered a background refetch that
      // could resolve the pre-update row mid-navigation (read-after-write
      // race), failing the completeness gate and bouncing the user straight
      // back to /complete-profile (LH-29). The authoritative row above is the
      // single source of truth; staleTime keeps it from refetching on arrival.
      hapticSuccess();
      toast.success("Profile complete — welcome to Helpr!");
      navigate("/dashboard", { replace: true });
    } catch (err: any) {
      const recovered = await recoverCompletedProfile();
      if (!recovered) { hapticError(); toast.error(err?.message || "We couldn't save your profile just yet — give it another try."); }
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
            <X className="w-4 h-4 mr-2" /> Sign out
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
  return (
    <AuthShell hideBack maxWidth="md">
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
            <p className="mt-2 text-[0.7rem] font-sans" style={{ color: "hsl(var(--olivewood) / 0.8)" }}>
              All fields marked <span style={{ color: "hsl(var(--burnt-sienna))" }}>*</span> are required.
            </p>
          </div>

          <ChecklistCard
            checklist={checklist}
            expanded={checklistExpanded}
            onToggle={() => setChecklistExpanded((v) => !v)}
          />

          <form
            onSubmit={handleSubmit}
            className="rounded-2xl border border-border/60 bg-card shadow-[var(--card-shadow)] p-6 sm:p-7 space-y-5"
          >
            {/* Circular profile picture uploader — top of form */}
            <div className="flex flex-col items-center gap-2 -mt-1">
              <label
                htmlFor="avatar"
                className="group relative cursor-pointer"
                aria-label={avatarPreview ? "Change profile picture" : "Upload profile picture"}
              >
                <div className="w-24 h-24 rounded-full overflow-hidden ring-2 ring-border bg-muted flex items-center justify-center transition-all group-hover:ring-primary/50">
                  {avatarPreview && avatarPreview.startsWith("blob:") ? (
                    <img loading="lazy" decoding="async" src={avatarPreview} alt="Profile preview" className="w-full h-full object-cover" />
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
                {avatarPreview
                  ? "Tap to change · JPG, PNG, WebP (5MB max)"
                  : <>Profile photo <span className="text-destructive">*</span> · tap to add</>}
              </p>
            </div>

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
              <DateOfBirthPicker id="dob" value={dateOfBirth} onChange={setDateOfBirth} />
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
                  placeholder="(225) 555-0123"
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
              <div className="flex items-center justify-between">
                <Label htmlFor="bio">About you <span className="text-destructive">*</span></Label>
                {/* "20" is a MINIMUM, not a cap — showing "91/20" once the
                    user is past it reads like an over-limit error. So:
                    "X/20 min" while short of the minimum, a check once met. */}
                {bio.trim().length >= 20 ? (
                  <span
                    className="text-ds-11 font-medium text-primary inline-flex items-center gap-1"
                    aria-live="polite"
                  >
                    <Check className="w-3 h-3" strokeWidth={3} /> Looks good
                  </span>
                ) : (
                  <span className="text-ds-11 tabular-nums text-muted-foreground" aria-live="polite">
                    {bio.trim().length}/20 min
                  </span>
                )}
              </div>
              <Textarea
                id="bio"
                rows={3}
                placeholder="A short intro neighbors will see on your profile (20+ characters)."
                value={bio}
                onChange={(e) => setBio(e.target.value)}
                autoCapitalize="sentences"
                className="rounded-ds-md"
              />
              {/* "Add later" affordance — bio is required by the
                  profile gate, but we set expectations that it can be
                  refined any time from Profile so the user doesn't feel
                  like this needs to be the bio of a lifetime. */}
              <p className="text-ds-11" style={{ color: "hsl(var(--olivewood) / 0.8)" }}>
                Don't sweat it — you can polish this any time from your profile.
              </p>
            </div>

            {/* ID */}
            <div className="space-y-1.5">
              {/* htmlFor pairs the visible heading with the file input the
                  wrapping <label> opens, so screen readers announce
                  "Government-issued ID, file" instead of an unlabeled input. */}
              <Label htmlFor="id-doc">
                Government-issued ID{" "}
                <span className="font-normal text-muted-foreground">(optional — add now or later)</span>
              </Label>
              <label
                htmlFor="id-doc"
                className="flex items-center gap-3 rounded-ds-md border border-dashed border-border p-3 cursor-pointer hover:bg-muted/40"
              >
                {idPreview && idPreview.startsWith("blob:") ? (
                  <img loading="lazy" decoding="async" src={idPreview} alt="ID preview" className="w-14 h-14 rounded-md object-cover" />
                ) : (
                  <div className="w-14 h-14 rounded-md bg-muted flex items-center justify-center">
                    <FileText className="w-5 h-5 text-muted-foreground" />
                  </div>
                )}
                <div className="text-ds-13">
                  <div className="font-medium">
                    {idFile ? idFile.name : profile?.id_document_url ? "Replace ID" : "Upload your ID"}
                  </div>
                  <div className="text-muted-foreground text-ds-11">Image or PDF. Max 5MB.</div>
                </div>
                <input
                  id="id-doc"
                  type="file"
                  accept="image/*,application/pdf"
                  className="hidden"
                  onChange={handleIdChange}
                />
              </label>
            </div>

            <label className="flex items-start gap-2.5 text-ds-11 cursor-pointer" style={{ color: "hsl(var(--olivewood) / 0.8)" }}>
              <Checkbox
                checked={acceptedPolicies}
                onCheckedChange={(v) => setAcceptedPolicies(v === true)}
                className="h-3.5 w-3.5 mt-[3px] shrink-0 [&_svg]:h-3 [&_svg]:w-3"
              />
              <span className="leading-relaxed">
                I agree to the{" "}
                <a href="/rules" target="_blank" rel="noreferrer" className="font-semibold hover:underline" style={{ color: "hsl(var(--bark))" }}>platform rules</a>,{" "}
                <a href="/terms" target="_blank" rel="noreferrer" className="font-semibold hover:underline" style={{ color: "hsl(var(--bark))" }}>terms</a>, and{" "}
                <a href="/privacy" target="_blank" rel="noreferrer" className="font-semibold hover:underline" style={{ color: "hsl(var(--bark))" }}>privacy policy</a>. <span style={{ color: "hsl(var(--burnt-sienna))" }}>*</span>
              </span>
            </label>

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
              {submitting ? "Saving…" : allComplete ? "Enter app" : "Complete all items above"}
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
              <X className="w-4 h-4 mr-2" /> Sign out
            </Button>
          </form>
      </div>
    </AuthShell>
  );
};

export default CompleteProfile;
