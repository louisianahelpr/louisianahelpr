import { Suspense, lazy, useEffect, useMemo, useRef, useState } from "react";
import { Navigate, useNavigate, useSearchParams } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { useSignOutAction } from "@/hooks/useSignOutAction";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { useQueryClient } from "@tanstack/react-query";
import { usePageTitle } from "@/hooks/usePageTitle";
import { toast } from "sonner";
import { contactLeakFieldError, contactLeakRejectionMessage } from "@/lib/contactLeakField";
import { FieldError } from "@/components/ui/FieldError";
import { AlertCircle, Check, Loader2, ShieldCheck, Trash2, X } from "lucide-react";
import { HelprSpinner } from "@/components/ui/HelprSpinner";
import { CityAutocomplete } from "@/components/postjob/CityAutocomplete";
import { cn } from "@/lib/utils";
import { isAppleAccount, isProfileComplete } from "@/components/ProtectedRoute";
import { splitName } from "@/lib/splitName";
import { isWriteRejected, mutationErrorMessage } from "@/lib/mutationResult";
import { hapticSuccess, hapticError } from "@/lib/haptics";
import AuthShell from "@/components/auth/AuthShell";
import { safeInternalRedirect } from "@/lib/authRedirects";
import { recoverCompletedProfile, saveCompletedProfile } from "./completeProfile/saveCompletedProfile";
import { CompleteProfileIntro } from "./completeProfile/CompleteProfileIntro";
import { useParishForZip, UNKNOWN_ZIP_MESSAGE } from "@/hooks/useParishForZip";
import { parishForCity } from "@/lib/parishes";
import { useDeleteAccount } from "@/hooks/useDeleteAccount";
import { userFacingError } from "@/lib/userFacingError";
import { useLanguage } from "@/lib/i18n/language";
import { StillNeededList } from "./completeProfile/StillNeededList";
import { CheckingProfileCard } from "./completeProfile/CheckingProfileCard";
import { CompleteProfileAvatar, useCompleteProfileAvatar } from "./completeProfile/CompleteProfileAvatar";

// Q292: an incomplete account cannot reach /profile (the gate sends it here),
// so in-app deletion (Apple 5.1.1(v), GDPR Art. 17) has to be offered here.
// Same hook, same dialog as Profile and AccountBanned: never a second handler.
const DeleteAccountDialog = lazy(() =>
  import("@/components/profile/DeleteAccountDialog").then((m) => ({ default: m.DeleteAccountDialog })),
);

const CompleteProfile = () => {
  const { lang, t } = useLanguage();
  usePageTitle(t("profileGate.pageTitle"));
  const navigate = useNavigate();
  const { signingOut, signOut } = useSignOutAction();
  const queryClient = useQueryClient();
  const { user, profile, isLoading, refresh } = useCurrentUser();
  const deleteAccount = useDeleteAccount();
  // Rendered by every branch below that can show while the flow is open: the
  // profile query may refetch (to "loading" or "no profile") once the account
  // is gone, and the dialog must survive that to say "Your account is deleted."
  const deleteDialog = deleteAccount.isOpen ? (
    <Suspense fallback={null}>
      <DeleteAccountDialog {...deleteAccount.dialogProps} />
    </Suspense>
  ) : null;
  const [searchParams] = useSearchParams();
  // Where the user was actually headed when the completeness gate
  // intercepted them (ProtectedRoute passes it as `?next=`). Before this,
  // the redirect dropped the destination entirely — a push deep link, a
  // shared job URL or an email link all ended on /home once the form
  // was done, with nothing left pointing at what they had opened.
  //
  // Re-validated here rather than trusted: `?next=` is attacker-supplied,
  // and `safeInternalRedirect` rejects protocol-relative, scheme-bearing,
  // control-character and auth-screen targets. Anything it refuses falls
  // back to the dashboard.
  const nextDestination = safeInternalRedirect(searchParams.get("next")) ?? "/home";

  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  // Apple/Google: the name is asked only when the provider gave no full name
  // (owner 2026-10-26). Set once, from the profile the sign-in created.
  const [providerGaveName, setProviderGaveName] = useState(false);
  // The 18+ box, the same one sign-up step 1 shows an email sign-up (owner,
  // 2026-10-14 ~3 PM CT): a Google/Apple sign-up never sees step 1, so it ticks
  // it here, and this screen asks no birthday and no phone. UNCHECKED by
  // default; hydrated from profiles.age_attested_at. An email sign-up ticked it
  // on step 1 (complete-signup refuses it otherwise), so it is not asked twice:
  // the same rule as ProtectedRoute's isProfileComplete.
  const [ageConfirmed, setAgeConfirmed] = useState(false);
  const ageBoxShown = user?.app_metadata?.provider !== "email";
  // App Store 4 (11-11): never ask an Apple sign-in for a name (socialAuth saves Apple's; Profile can add one).
  const nameAsked = !isAppleAccount(user);
  const ageDone = ageConfirmed || !ageBoxShown;
  const [location, setLocation] = useState("");
  // Optional — mirrors the same field on Signup.tsx's email path (S-001).
  const [zipCode, setZipCode] = useState("");
  const { parish: resolvedZipParish, unknownZip } = useParishForZip(zipCode, location, setLocation);
  // Soft mismatch hint — see the identical comment in Signup.tsx.
  const cityZipMismatch = (() => {
    if (!resolvedZipParish) return null;
    const cityParish = parishForCity(location);
    if (!cityParish || cityParish.name === resolvedZipParish) return null;
    return t("profileGate.zipMismatch", { zipParish: resolvedZipParish, city: location.trim(), cityParish: cityParish.name });
  })();
  const [bio, setBio] = useState("");
  // Contact details in a bio never save (rejected server-side, 23514).
  const bioLeak = contactLeakFieldError(bio, "bio");
  // Hydrated from profile.accepted_terms_at on mount so users who already
  // accepted (and were bounced back here for some other missing field, or who
  // simply refreshed the page) don't have to re-tick the box.
  const [acceptedPolicies, setAcceptedPolicies] = useState(false);

  // The photo: picked file, preview, pick + crop (completeProfile/CompleteProfileAvatar.tsx).
  const { avatarFile, avatarPreview, avatarBroken, setAvatarBroken, handleAvatarChange, avatarCropDialog } =
    useCompleteProfileAvatar(profile?.avatar_url, t);

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
    if (parsedFirst && parsedLast) setProviderGaveName(true);
    if (profile.age_attested_at) setAgeConfirmed(true);
    if (profile.location && !location) setLocation(profile.location);
    if (profile.zip_code && !zipCode) setZipCode(profile.zip_code);
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
    //
    // BOTH columns are consulted. `accepted_terms_at` was written only by this
    // screen and `terms_accepted_at` only by `complete-signup` / the re-consent
    // modal, so a user who ticked the box during signup (which every signup
    // forces) and later landed here was asked to agree a second time to
    // policies they had already accepted — the row said so, in the column this
    // screen wasn't reading.
    if (profile.accepted_terms_at || profile.terms_accepted_at) setAcceptedPolicies(true);
  // Intentionally scoped to user_id so a stable user never re-triggers this.
  // The hydratedRef is the real guard; user_id is included to correctly reset
  // the gate when the logged-in user changes (e.g. in a shared-device test).
  }, [profile?.user_id]);



  // Live checklist: name, the 18+ box (Google/Apple) and the policies. City
  // and ZIP are optional here and on sign-up step 2 (owner 2026-10-26), so
  // neither is in this list or in ProtectedRoute's gate. Never add one to the
  // gate while the form lets it be skipped: that is the redirect loop
  // ProtectedRoute's comment records twice.
  //
  // Each item is satisfied either by the local form state OR by an existing
  // value already on the profile row (e.g. an avatar uploaded previously).
  const checklist = useMemo(() => {
    return [
      ...(nameAsked ? [{ label: t("profileGate.needName"), step: t("profileGate.stepName"), done: firstName.trim().length > 0 && lastName.trim().length > 0 }] : []),
      ...(ageBoxShown ? [{ label: t("profileGate.needAge"), step: t("profileGate.stepAge"), done: ageConfirmed }] : []),
      // City and ZIP left the checklist (owner 2026-10-26: optional, as on
      // sign-up step 2); a typed ZIP is still checked on submit.
      // Government-issued ID is intentionally NOT in the required checklist:
      // new signup (SignupStep2) no longer collects it, and identity
      // verification is deferred to first-post / IDV. The upload field below
      // stays available so a user CAN attach it early, but it never blocks
      // profile completion.
      { label: t("profileGate.needPolicies"), step: t("profileGate.stepPolicies"), done: acceptedPolicies },
    ];
  }, [
    lang, t,
    firstName, lastName, nameAsked,
    ageBoxShown,
    ageConfirmed,
    acceptedPolicies,
  ]);

  const allComplete = checklist.every((c) => c.done);

  const firstNameValid = firstName.trim().length > 0;
  const lastNameValid = lastName.trim().length > 0;
  const cityValid = location.trim().length > 0;
  // The ✓ means "recognised", not "five digits". An unrecognised ZIP already
  // renders its own warning below, so a check beside it would contradict it.
  const zipValid = zipCode.length === 5 && !unknownZip && !!resolvedZipParish;

  useEffect(() => {
    if (!user?.id || profile || isLoading) return;
    void refresh();
    const retry = window.setInterval(() => void refresh(), 2500);
    return () => window.clearInterval(retry);
     
  }, [user?.id, Boolean(profile), isLoading]);

  // F455 (audit 11-10): a finished profile that opens this page (an old link, a back button) is sent on to /home below;
  // it used to go with no word. One toast says why. Not after a save made here: the cache turns complete a render
  // before navigate() runs, and that member just finished, nothing was "already" done.
  const alreadyComplete = !!profile && (profile.is_legacy_user === true || isProfileComplete(profile, user));
  const savedHereRef = useRef(false);
  const toldAlreadyCompleteRef = useRef(false);
  useEffect(() => {
    if (!alreadyComplete || submitting || savedHereRef.current || toldAlreadyCompleteRef.current) return;
    toldAlreadyCompleteRef.current = true;
    toast(t("profileGate.alreadyComplete"));
  }, [alreadyComplete, submitting, t]);

  // After a failed save: a profile complete anyway is read back and the member goes on (completeProfile/saveCompletedProfile.ts).
  const recover = () => recoverCompletedProfile({ user, t, queryClient, navigate, nextDestination });

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user) return;

    const fail = (msg: string) => { hapticError(); toast.error(msg); };
    if (nameAsked && (!firstName.trim() || !lastName.trim())) return fail(t("profileGate.nameToast"));
    // The same words Signup.tsx says when step 1's 18+ box is left empty.
    if (!ageDone) return fail(t("signup.ageToast"));
    // City and ZIP are optional (owner 2026-10-26); a typed ZIP is five digits.
    { const zip = zipCode.replace(/\D/g, ""); if (zip && zip.length !== 5) return fail(t("profileGate.zipToast")); }
    // Government-issued ID is no longer required here — it's optional at
    // profile completion and deferred to first-post / IDV (matches the
    // signup gate, which stopped collecting it).
    if (!acceptedPolicies) return fail(t("profileGate.policiesToast"));
    // Contact details in a bio are REJECTED by the database (23514); the
    // field already says so inline — block before the round-trip.
    if (bioLeak) return fail(bioLeak);

    setSubmitting(true);
    try {
      // The one write: the row, the photo, the consent trail and the cache (completeProfile/saveCompletedProfile.ts).
      await saveCompletedProfile({
        user, profile, firstName, lastName, bio, location, zipCode, resolvedZipParish, ageBoxShown, avatarFile, t, queryClient,
      });
      savedHereRef.current = true;
      hapticSuccess();
      navigate(nextDestination, { replace: true });
    } catch (err: unknown) {
      const recovered = await recover();
      if (!recovered) {
        hapticError();
        // A silently-rejected write gets its own sentence (the row wasn't
        // ours / wasn't there); everything else keeps the human fallback so a
        // raw PostgREST code never reaches the one screen a user cannot leave.
        // The contact-leak trigger's message is the one server text shown
        // verbatim: written for the user, names the field.
        toast.error(
          contactLeakRejectionMessage(err)
            ?? (isWriteRejected(err)
              ? mutationErrorMessage(err)
              : userFacingError(err, t("profileGate.saveFailed"))),
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
        {deleteDialog}
      </div>
    );
  }

  if (user && !profile) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-premium-page px-5">
        <CheckingProfileCard signingOut={signingOut} onSignOut={() => { void signOut({ after: () => navigate("/login", { replace: true }) }); }} t={t} />
        {deleteDialog}
      </div>
    );
  }

  // Don't trap users who don't actually need this gate. Legacy accounts
  // bypass entirely, and anyone whose profile already satisfies the gate
  // gets bounced straight to the dashboard instead of staring at an empty
  // checklist they can't dismiss.
  // See the divergence note on `checklist` above before touching this gate.
  if (alreadyComplete) {
    return <Navigate to="/home" replace />;
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
            <h1
              // One page-title size everywhere (Q236(e)): text-headline-hero.
              className="font-display font-bold text-headline-hero leading-tight mt-2"
              style={{
                color: "hsl(var(--ink-deep))",
                letterSpacing: "-0.025em",
              }}
            >
              {t("profileGate.title")}
            </h1>
            <CompleteProfileIntro />
          </div>

          <form
            onSubmit={handleSubmit}
            className="rounded-2xl border border-border/60 bg-card shadow-[var(--card-shadow)] p-6 sm:p-7 space-y-5"
          >
            {/* Always shown, pre-filled when already known (an email signup
                already has this from SignupStep2; Google/Apple never
                collected it) — so the person can double-check what came
                over from the provider instead of it disappearing silently. */}
            <CompleteProfileAvatar
              avatarPreview={avatarPreview}
              avatarBroken={avatarBroken}
              setAvatarBroken={setAvatarBroken}
              handleAvatarChange={handleAvatarChange}
              t={t}
            />

            {/* Asked only when the provider gave no full name (owner 2026-10-26:
                "Apple/Google: ask first+last only if the provider gave no full
                name"). Google usually returns one; Apple often does not. */}
            {nameAsked && !providerGaveName && (
            <div className="grid grid-cols-2 gap-3" data-testid="complete-profile-names">
              <div className="space-y-1.5">
                <Label htmlFor="firstName">{t("signup.firstName")} <span className="text-[hsl(var(--destructive-ink))]">*</span></Label>
                <div className="relative">
                  <Input
                    id="firstName"
                    autoComplete="given-name"
                    autoCapitalize="words"
                    value={firstName}
                    onChange={(e) => setFirstName(e.target.value)}
                    className={`rounded-ds-md text-ellipsis ${firstNameValid ? "pr-8" : ""}`}
                  />
                  {firstNameValid && (
                    <Check className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-primary pointer-events-none" aria-hidden />
                  )}
                </div>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="lastName">{t("signup.lastName")} <span className="text-[hsl(var(--destructive-ink))]">*</span></Label>
                <div className="relative">
                  <Input
                    id="lastName"
                    autoComplete="family-name"
                    autoCapitalize="words"
                    value={lastName}
                    onChange={(e) => setLastName(e.target.value)}
                    className={`rounded-ds-md text-ellipsis ${lastNameValid ? "pr-8" : ""}`}
                  />
                  {lastNameValid && (
                    <Check className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-primary pointer-events-none" aria-hidden />
                  )}
                </div>
              </div>
            </div>
            )}

            {/* City takes what is left; ZIP is a fixed 7rem so five digits
                plus the valid ✓ fit at 320-430 (a third of the row was 85px at 375,
                and with the check's padding the value read "705", 2026-09-12). */}
            <div className="grid grid-cols-[minmax(0,1fr)_7rem] gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="city">{t("signup.city")} <span className="font-normal text-muted-foreground">{t("signup.optional")}</span></Label>
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
                    className={`rounded-ds-md text-ellipsis ${cityValid ? "pr-8" : ""}`}
                  />
                  {cityValid && (
                    <Check className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-primary pointer-events-none z-10" aria-hidden />
                  )}
                </div>
              </div>
              {/* Optional (owner 2026-10-26), as on sign-up step 2; this one
                  covers the social sign-ins that never see that step. */}
              <div className="space-y-1.5">
                <Label htmlFor="zipCode">
                  {t("signup.zip")} <span className="font-normal text-muted-foreground">{t("signup.optional")}</span>
                </Label>
                {/* Same valid ✓ as City beside it (owner, 2026-09-12:
                    "missing the check even though the zip is entered"). */}
                <div className="relative">
                  <Input
                    id="zipCode"
                    value={zipCode}
                    onChange={(e) => setZipCode(e.target.value.replace(/\D/g, "").slice(0, 5))}
                    inputMode="numeric"
                    autoComplete="postal-code"
                    maxLength={5}
                    placeholder={t("signup.zipExample")}
                    className={`rounded-ds-md text-ellipsis ${zipValid ? "pr-8" : ""}`}
                  />
                  {zipValid && (
                    <Check className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-primary pointer-events-none" aria-hidden />
                  )}
                </div>
              </div>
            </div>
            {/* An unrecognised ZIP used to render nothing at all here, which is
                how someone could finish this form and be invisible to the job
                fan-out with no one — them or us — any the wiser. */}
            {unknownZip && (
              <p role="status" className="flex items-start gap-1 text-ds-11 -mt-1" style={{ color: "hsl(var(--sienna-ink))" }}>
                <AlertCircle className="w-3 h-3 shrink-0 mt-0.5" aria-hidden />
                {t(UNKNOWN_ZIP_MESSAGE)}
              </p>
            )}
            {cityZipMismatch && (
              <p className="flex items-center gap-1 text-ds-11 -mt-1" style={{ color: "hsl(var(--sienna-ink))" }}>
                <AlertCircle className="w-3 h-3 shrink-0" aria-hidden />
                {cityZipMismatch}
              </p>
            )}

            <div className="space-y-1.5">
              <Label htmlFor="bio">{t("signup.about")} <span className="font-normal" style={{ color: "hsl(var(--olivewood) / 0.7)" }}>{t("signup.optional")}</span></Label>
              <Textarea
                id="bio"
                rows={3}
                placeholder={t("profileGate.bioPlaceholder")}
                value={bio}
                onChange={(e) => setBio(e.target.value)}
                autoCapitalize="sentences"
                className="rounded-ds-md"
                aria-invalid={!!bioLeak || undefined}
                aria-describedby={bioLeak ? "bio-contact-leak" : undefined}
              />
              <FieldError id="bio-contact-leak">{bioLeak}</FieldError>
              <p className="text-ds-11" style={{ color: "hsl(var(--olivewood) / 0.8)" }}>
                {t("profileGate.bioLater")}
              </p>
            </div>

            {/* aria-labelledby, NOT the wrapping <label> alone — same reason
                as SignupStep1's consent row: Radix renders Checkbox as
                <button role="checkbox"> with empty content, so the box
                announced as an unnamed checkbox while the user was agreeing to
                the rules, terms and privacy policy. */}
            <label htmlFor="accept-policies" className="flex min-h-11 items-start gap-2.5 text-ds-11 cursor-pointer" style={{ color: "hsl(var(--olivewood) / 0.8)" }}>
              <Checkbox
                id="accept-policies"
                aria-labelledby="accept-policies-label"
                checked={acceptedPolicies}
                onCheckedChange={(v) => setAcceptedPolicies(v === true)}
                className="mt-px shrink-0"
              />
              <span id="accept-policies-label" className="leading-relaxed">
                {/* Wording/order matches SignupStep1's identical consent row
                    (Terms, Rules & Privacy) so the same box reads the same
                    way everywhere a user ticks it. */}
                {t("signup.agreeLead")}{" "}
                <a href="/terms" target="_blank" rel="noreferrer" className="font-semibold hover:underline" style={{ color: "hsl(var(--bark))" }}>{t("signup.terms")}</a>,{" "}
                <a href="/rules" target="_blank" rel="noreferrer" className="font-semibold hover:underline" style={{ color: "hsl(var(--bark))" }}>{t("signup.rules")}</a>{` ${t("signup.and")} `}
                <a href="/privacy" target="_blank" rel="noreferrer" className="font-semibold hover:underline" style={{ color: "hsl(var(--bark))" }}>{t("signup.privacy")}</a>. <span style={{ color: "hsl(var(--sienna-ink))" }}>*</span>
                {/* Terms, Rules and Privacy are not translated: a Spanish reader is told they open in English. */}
                {lang === "es" && <span className="block" data-testid="legal-in-english">{t("lang.legalInEnglish")}</span>}
              </span>
            </label>

            {/* The 18+ box: the same sentence sign-up step 1 shows an email
                sign-up (owner, 2026-10-14), laid out like the consent row
                above it. Required, UNCHECKED by default. */}
            {ageBoxShown && (
              <label htmlFor="age-confirm" className="flex min-h-11 items-start gap-2.5 text-ds-11 cursor-pointer -mt-2" style={{ color: "hsl(var(--olivewood) / 0.8)" }}>
                <Checkbox
                  id="age-confirm"
                  aria-labelledby="age-confirm-label"
                  checked={ageConfirmed}
                  onCheckedChange={(v) => setAgeConfirmed(v === true)}
                  className="mt-px shrink-0"
                />
                <span id="age-confirm-label" className="leading-relaxed">
                  {t("profileGate.ageConfirm")} <span style={{ color: "hsl(var(--sienna-ink))" }}>*</span>
                </span>
              </label>
            )}

            <StillNeededList checklist={checklist} allComplete={allComplete} t={t} />

            <Button
              type="submit"
              size="lg"
              className={cn(
                "w-full",
                // The label is clipped at 320px without this. `size="lg"` is
                // `h-[60px] px-8` and `Button`'s base class is
                // `whitespace-nowrap`, so at a 320px viewport the button box is
                // 230px, 64px of that is padding, and "Complete Required
                // Fields" needs 226px in 166px of room — measured
                // scrollWidth 245 vs clientWidth 230, i.e. the primary action
                // on the one screen a blocked user cannot leave was running off
                // its own button. Narrow padding plus a permitted wrap fixes it
                // without touching the shared `Button` variants: the label
                // wraps to two lines under `sm`, and `h-auto`/`min-h-[60px]`
                // keeps the tap target at its full size instead of clipping.
                //
                // `!min-h-[60px]`, not `min-h-[60px]`: index.css's bare
                // `button { min-height: 44px }` is unlayered, so it beat the
                // utility and this rendered 49.5px beside a 60px Sign Out.
                "h-auto !min-h-[60px] whitespace-normal min-[360px]:whitespace-nowrap text-balance px-4 py-3 sm:px-8 sm:py-0",
                allComplete && !submitting && "btn-grad-primary",
              )}
              disabled={submitting || !allComplete}
            >
              {submitting ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <ShieldCheck className="w-4 h-4 mr-2" />}
              {submitting ? t("profileGate.saving") : allComplete ? t("profileGate.enterApp") : t("profileGate.completeRequired")}
            </Button>

            <Button
              type="button"
              variant="outline"
              size="lg"
              onClick={() => { void signOut({ after: () => navigate("/login", { replace: true }) }); }}
              disabled={signingOut}
              className="w-full"
            >
              <X className="w-4 h-4 mr-2" /> {signingOut ? t("profileGate.loggingOut") : t("profileGate.signOut")}
            </Button>

            {/* Same treatment as AccountBanned's, the other account-state
                screen: a quiet ghost button, destructive-coloured. */}
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={deleteAccount.requestDelete}
              className="w-full text-destructive-ink hover:text-destructive-ink"
            >
              <Trash2 className="w-4 h-4 mr-1" /> {t("profileGate.deleteAccount")}
            </Button>

            {/* The only route to a human from inside the gate. ProtectedRoute's
                PROFILE_GATE_ALLOWED set lets a half-onboarded user reach
                /support, /terms, /rules, /privacy and /profile?tab=legal — but
                until now this screen linked to four of those five and never to
                support, so the escape hatch existed and was invisible. Someone
                stuck on a field they cannot satisfy (a phone number the format
                rejects, a city not in the list) had "Sign out" as their only
                other affordance. /help is NOT on the allowed list, so link
                /support, which is. */}
            <p className="text-center text-ds-11" style={{ color: "hsl(var(--olivewood) / 0.8)" }}>
              {t("profileGate.stuck")}{" "}
              <a href="/support" className="font-semibold hover:underline" style={{ color: "hsl(var(--bark))" }}>
                {t("profileGate.contactSupport")}
              </a>
            </p>
          </form>
      </div>
      {avatarCropDialog}
      {deleteDialog}
    </AuthShell>
  );
};

export default CompleteProfile;
