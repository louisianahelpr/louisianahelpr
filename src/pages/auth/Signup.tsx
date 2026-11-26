import { useEffect, useState, useRef } from "react";
import { clearSignupDraft, useSignupDraftField, useSignupEmailField } from "./signup/useSignupDraftField";
import { removeShellOncePainted } from "@/components/landing/landingShell";
import { useNavigate, useSearchParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { usePageMeta } from "@/hooks/usePageMeta";
import { NOINDEX_PAGE_META } from "@/lib/publicPageMeta.mjs";
import { checkPasswordPwned } from "@/lib/hibpCheck";
import { track, AhaEvent } from "@/lib/analytics";
import { ppoTrackingProps } from "@/lib/ppoAttribution";
import { safeStorage } from "@/lib/safeStorage";
import { report } from "@/lib/errorLogger";
import { useSignupLeadCapture } from "@/lib/signupLead";
import { withTimeout } from "@/pages/auth/completeProfile/constants";
import { invokeWithOneRetryIfUnsent } from "@/pages/auth/signup/retrySignupCompletion";
import AuthShell from "@/components/auth/AuthShell";
import { TurnstileField } from "@/components/auth/TurnstileField";
import { useCaptcha } from "@/hooks/useCaptcha";
import { isCaptchaError } from "@/lib/turnstile";
import { peekJobIntent, peekSignupRedirectItem, signupSubtitle } from "@/lib/jobIntent";
import { useSignupEntry } from "./signup/useSignupEntry";
import { hapticMedium, hapticSuccess, hapticError } from "@/lib/haptics";
import {
  SIGNUP_COOLDOWN_MS,
  SIGNUP_COOLDOWN_KEY,
  passwordProblem,
  isAlreadyRegistered,
  noteSignupRedirect,
} from "./signup/signupHelpers";
import { SignupStep1 } from "./signup/SignupStep1";
import { getSignupConfirmRedirect } from "@/lib/authRedirects";
import { userFacingError } from "@/lib/userFacingError";
import { isWeakPasswordError, recognizedAuthError, weakPasswordWords } from "@/lib/authErrors";
import { completeSignupErrorCopy, isSignupAlreadyFinished, isSignupResumedOldAccount, SIGNUP_ALREADY_FINISHED_COPY, SIGNUP_RESUMED_OLD_ACCOUNT_COPY } from "./signup/completeSignupError";
import { getLang, useLanguage } from "@/lib/i18n/language";
import { joinName } from "@/lib/splitName";
import { LanguageToggle } from "@/components/LanguageToggle";
import { clearPendingSignup, readPendingSignup, rememberPendingSignup } from "@/lib/pendingSignup";
import { PendingSignupCard } from "@/components/auth/PendingSignupCard";

const Signup = () => {
  const { t } = useLanguage();
  const navigate = useNavigate();
  // Q401a: the same table api/share.ts serves pre-JS (src/lib/publicPageMeta.mjs), noindex included.
  usePageMeta(NOINDEX_PAGE_META["/signup"]);
  // Q2705 A: index.html draws this page first (#lh-signup-shell); take it away once this one is painted.
  useEffect(() => removeShellOncePainted("lh-signup-shell"), []);
  const [searchParams] = useSearchParams();
  useSignupEntry(searchParams, navigate); // ?job= / ?redirect= / ?ref= kept, signed-in bounce, funnel start
  // Owner 11-20 (ease batch, item 6): a sign-up on this device still waiting on its email. Every account action sends
  // a signed-out visitor here, so this is the one place that says "Check your email to finish" (PendingSignupCard).
  const [pendingSignup, setPendingSignup] = useState(() => readPendingSignup());
  // ONE screen (owner 11-23 ~10:05 PM: "There shouldn't be a screen 2"). The old "About you" step's photo, city, ZIP
  // and bio are not asked: they are added later from Edit Profile, and its "Skip for now" already sent none of them,
  // so the account this screen creates is the one a skipped step 2 created. Its optional referral code moved here.
  const [loading, setLoading] = useState(false);
  // OA-002: one tap, one signUp(). `loading` is only set inside createAccountAndFinish, after the awaited
  // validation, so a second tap during validation got through the disabled check and fired a second auth.signUp().
  const submittingRef = useRef(false);
  const captcha = useCaptcha();
  const captureLead = useSignupLeadCapture(captcha.ref); // spends a token from the same widget (Q1589)
  // Turnstile (Q1314), right above "Create account", as on Login (A3-C1). signUp takes the ready token first; the
  // lead capture asks right after and gets the next one the widget mints (tokens are single-use).
  const turnstile = <TurnstileField ref={captcha.ref} action="signup" />;

  // The form's fields
  const [firstName, setFirstName] = useSignupDraftField("firstName"); // F259c: kept over a reload
  const [lastName, setLastName] = useSignupDraftField("lastName");
  const fullName = joinName(firstName, lastName);
  const [email, setEmail] = useSignupEmailField(); // signup-confusion 11-19: also fills an email Log in carried over
  const [password, setPassword] = useState("");
  // Settable since 2026-09-22: a code heard, read on a flyer or in a comment had no way in when `?ref=` was the only
  // door. The link pre-fills it, normalised on the way in (trim + upper) so a link's code and a typed one look alike.
  const [referralCode, setReferralCode] = useState(
    (searchParams.get("ref") || "").trim().toUpperCase(),
  );
  const [acceptedPolicies, setAcceptedPolicies] = useState(false);
  // Explicit 18+ attestation (legal, real-money platform): the age gate at account creation;
  // the server enforces it too via ageAttested.
  const [ageConfirmed, setAgeConfirmed] = useState(false);
  // Marketing / promotional email opt-in — UNCHECKED by default so a user
  // who doesn't tick it never gets marketing mail. Persists to
  // profiles.marketing_consent via complete-signup below; the marketing
  // sender filters on it.
  const [marketingConsent, setMarketingConsent] = useState(false);
  const [showPassword, setShowPassword] = useState(false);

  // The server's refusal of the password (HIBP or GoTrue weak_password), shown under the password field until the
  // password changes (AUD31-53).
  const [serverPasswordError, setServerPasswordError] = useState<string | null>(null);
  // Every other refusal of "Create account" (audit 11-23: they were toasts gone in under 3 s), shown in a box right
  // above the button until the next try. The password's own reasons stay under its field (serverPasswordError).
  const [formError, setFormError] = useState<string | null>(null);
  const refuse = (words: string, field?: string) => {
    setFormError(words);
    // The one form's refusals stay on the funnel (this was step 2's validation event).
    if (field) track(AhaEvent.SignupStepValidationFailed, { step: 1, error_fields: [field], ...ppoTrackingProps() });
    return false;
  };

  // Validates the form (names, email, password, agreements).
  const validateAccountStep = async () => {
    if (!firstName.trim()) return refuse(t("signup.firstNameToast"), "firstName");
    if (!lastName.trim()) return refuse(t("signup.lastNameToast"), "lastName");
    if (!email.trim()) return refuse(t("signup.emailToast"), "email");
    // The password rules must match the Supabase project's policy exactly.
    // They did not: the project requires a lowercase letter, an uppercase
    // letter, a digit AND a symbol, while this validator asked for only the
    // middle two. A password like "Password1" therefore sailed past the form,
    // reached `auth.signUp`, and came back as a 422 whose raw body — "Password
    // should contain at least one character of each:
    // abcdefghijklmnopqrstuvwxyz, ABCDEFGHIJKLMNOPQRSTUVWXYZ, 0123456789,
    // !@#$%^&*()_+-=[]{};':\"|<>?,./`~." — was thrown straight into
    // `toast.error(err.message)` at the bottom of createAccountAndFinish.
    // Verified against prod 2026-09-01. Each rule now fails locally, in
    // English, before the round-trip.
    //
    // They are spelled out ONCE, in PASSWORD_RULES (signupHelpers), because
    // fixing them here left SignupStep1's own inline gate still checking three
    // of the five — so the step waved through passwords this function then
    // rejected with a toast about a rule the form had never displayed. One
    // list now feeds this check, the inline gate, the requirement chips and
    // the inline error message; they cannot drift apart again.
    const pwProblem = passwordProblem(password);
    if (pwProblem) return refuse(pwProblem, "password");
    if (!acceptedPolicies) return refuse(t("signup.termsToast"), "terms");
    if (!ageConfirmed) return refuse(t("signup.ageToast"), "age");
    return true;
  };

  const completeProfile = async (userId: string, gaveUp: AbortSignal | undefined) => {
    // Photo, bio, city, ZIP (and its parish), skills, credentials and portfolio are all added later from Edit
    // Profile; sign-up sends them empty, exactly as the old step 2's "Skip for now" did, and the edge function
    // defaults each to null. Hourly rate was retired 2026-08-27 (poster-set pricing).
    // One more send when the first never got an answer (Q1810); why that is safe: retrySignupCompletion.ts.
    const { data: result, error: fnError } = await invokeWithOneRetryIfUnsent(() => supabase.functions.invoke("complete-signup", {
      body: {
        userId,
        avatarBase64: null,
        avatarExt: null,
        avatarContentType: null,
        bio: "",
        location: "",
        zipCode: "",
        parish: null,
        // Explicit marketing-email consent captured at signup. Defaults to
        // false server-side; passing it here lets a user who ticked the box
        // opt in at account-creation time.
        marketingConsent,
        // 18+ attestation. DOB is deferred, so this is what satisfies the
        // server's legal age gate on the initial completion path.
        ageAttested: ageConfirmed,
        // Affirmative acceptance of the Terms / Privacy / Platform Rules.
        // The tick is a hard client gate (validateAccountStep refuses to
        // advance without it), but until now the server only INFERRED consent
        // from the fact that a completion arrived. Sending the assertion means
        // the recorded consent is something the user actually stated, not
        // something we deduced — which is the difference that matters when the
        // legal_acceptances row is the evidence.
        termsAccepted: acceptedPolicies,
        // `?ref=<code>` from a referral share link. Recorded SERVER-side now —
        // see the comment where the old client-side RPC used to live, below.
        // Normalised here as well as server-side: process_referral already
        // upper-cases and trims, so casing/whitespace must never be the reason
        // a hand-typed code fails. Empty stays null — never an empty string.
        referralCode: referralCode.trim().toUpperCase() || null,
      },
    }), undefined, gaveUp);

    if (fnError) {
      // NOT `fnError.message`. supabase-js sets that to one of three fixed
      // transport strings ("Failed to send a request to the Edge Function",
      // "Relay Error invoking the Edge Function", "Edge Function returned a
      // non-2xx status code") and puts this function's OWN sentence in the
      // response body hanging off `fnError.context`. Throwing the message
      // therefore threw away every word complete-signup wrote for a human and
      // handed the person a wrapper instead — and the `|| "…"` fallback that
      // looked like the safety net never fired, because the message is never
      // empty. completeSignupErrorCopy names the shape and, on the one that
      // carries our copy, reads it. See completeSignupError.ts.
      throw new Error(await completeSignupErrorCopy(fnError));
    }

    if (result?.error) {
      throw new Error(result.error);
    }

    return result;
  };

  const createAccountAndFinish = async () => {
    hapticMedium();
    setLoading(true);

    // Rate limiting
    const lastAttempt = parseInt(safeStorage.getItem(SIGNUP_COOLDOWN_KEY) || "0", 10);
    const elapsed = Date.now() - lastAttempt;
    if (elapsed < SIGNUP_COOLDOWN_MS) {
      const secsLeft = Math.ceil((SIGNUP_COOLDOWN_MS - elapsed) / 1000);
      hapticError();
      setFormError(t("signup.tooManyAttempts", { seconds: secsLeft }));
      setLoading(false);
      return;
    }
    try {
      // HIBP breached-password check (k-anonymity, fail-open). A hit shows the reason under the password field
      // (signup-submit 11-23) and sends nothing.
      const pwnedCount = await checkPasswordPwned(password);
      if (pwnedCount !== null && pwnedCount > 0) {
        setServerPasswordError(t("signup.passwordPwned", { count: pwnedCount.toLocaleString() }));
        captureLead(email); // ONE "finish signing up" reminder (owner 2026-10-09); never blocks
        setLoading(false);
        return;
      }

      // Arm the cooldown only once a real signUp attempt fires. Arming it up
      // front (pre-HIBP, pre-phone-check) punished the user whose password or
      // phone was REJECTED locally with a 60s "Too many attempts" on the very
      // retry that would have fixed it.
      safeStorage.setItem(SIGNUP_COOLDOWN_KEY, String(Date.now()));

      // F260q: `lang` (switch, else browser) -> confirm email (auth-email-hook) + profiles.language (handle_new_user).
      const signingUp = captcha.run((captchaToken) => supabase.auth.signUp({
        email: email.trim(),
        password,
        options: { emailRedirectTo: getSignupConfirmRedirect(peekJobIntent(), peekSignupRedirectItem()), data: { full_name: fullName, lang: getLang() }, captchaToken },
      }));
      // After signUp has TAKEN the ready token (runWithCaptcha asks synchronously), so the capture waits for the next
      // one instead of holding signUp on a fresh challenge. ONE "finish signing up" reminder (owner 2026-10-09); never
      // blocks, and the reminder sender skips an address that became an account (signup-lead-reminders).
      try { captureLead(email); } catch (leadErr) { report(leadErr, { tags: { source: "Signup.captureLead" } }); } // never blocks signUp
      const { data: authData, error: authError } = await signingUp;
      // A refused security check (Q1314) is not a real attempt: lift the cooldown.
      if (authError && isCaptchaError(authError.message)) safeStorage.removeItem(SIGNUP_COOLDOWN_KEY);

      if (authError && isAlreadyRegistered(authError.message)) {
        // Privacy-first: never confess whether an email is registered (see
        // noteSignupRedirect for the enumeration reasoning).
        noteSignupRedirect();
        navigate("/login");
        return;
      }
      if (authError) throw authError;
      const userId = authData.user?.id;
      if (!userId) throw new Error("Account creation failed");
      clearSignupDraft(); // F259c: the account exists, so the reload draft goes

      // Complete profile with uploads (no ID — Stripe handles identity). This call also records the referral and the
      // legal consent — see the body it sends above.
      // OA-001: from here on the account EXISTS. A failed or hung completion
      // used to end on "Couldn't create your account — try again?", and trying
      // again cannot work: signUp on a now-registered email takes the
      // enumeration redirect to /login. So a completion failure goes to the
      // same "Check your email" screen as success. First sign-in then lands on
      // /complete-profile (the profile gate) behind the non-dismissible
      // re-consent gate, which records the consent this call would have.
      let result: Awaited<ReturnType<typeof completeProfile>>;
      try {
        const gaveUp = new AbortController(); // aborted when the 60 s wait gives up, so a pending second send never goes out after it (Q1810)
        result = await withTimeout(completeProfile(userId, gaveUp.signal), t("signup.finishingLabel")).finally(() => gaveUp.abort());
      } catch (completionErr) {
        const finished = isSignupAlreadyFinished(completionErr); // a resubmit, not a failure (Q1643)
        const resumed = isSignupResumedOldAccount(completionErr); // a second sign-up on an older unconfirmed account (Q2514)
        if (!finished && !resumed) { hapticError(); report(completionErr, { tags: { source: "Signup.completeProfile" } }); }
        toast[finished || resumed ? "info" : "error"](finished ? SIGNUP_ALREADY_FINISHED_COPY : resumed ? SIGNUP_RESUMED_OLD_ACCOUNT_COPY :
          `${userFacingError(completionErr, t("signup.finishFailed"))} ${t("signup.accountCreatedConfirm")}`,
        );
        rememberPendingSignup(email); // owner 11-20: /signup says "Check your email to finish" until it is verified
        navigate("/signup-pending", { state: { email } });
        return;
      }

      // A previous avatar object the function's sweep could NOT confirm is
      // gone. `complete-signup` has returned this field all along — "returned
      // to the caller rather than only logged, so a still-public previous
      // photo is something the app can surface to the person whose photo it
      // is" — and nothing on this screen had ever read it, so on the signup
      // path the sweep's one user-visible signal was dropped on the floor.
      // It is reachable here: a resubmission re-uploads over an existing
      // folder, and a legacy `avatar.<anything>` key from the old scheme is
      // exactly what the sweep exists to retire. The `avatars` bucket is
      // public and has twice held a mis-tapped identity document, so silence
      // is the failure, not the inconvenience. Same copy as
      // CompleteProfile.tsx — one sentence, one meaning, two screens.
      const staleAvatarObjects =
        (result as { staleAvatarObjects?: string[] } | null)?.staleAvatarObjects ?? [];
      if (staleAvatarObjects.length > 0) {
        toast.error(
          t("photo.staleAvatar"),
        );
      }

      // WHY THERE IS NO `supabase.rpc("process_referral", …)` HERE ANY MORE.
      //
      // There used to be, and it could never have worked. `process_referral`
      // was hardened on 2026-08-19 to require `auth.uid() = p_new_user_id`,
      // and it is GRANTed to `authenticated` only. This runs immediately after
      // `supabase.auth.signUp`, which — with email confirmation on, as it is in
      // prod — returns NO session. So the RPC went out as `anon` and came back
      // 401 `42501 permission denied for function process_referral`, every
      // single time. The client only `report()`ed it, so the failure was
      // invisible to the user and to the funnel: prod holds 29 rows in
      // `referral_codes`, 0 rows in `referrals`, and the only 2
      // `referral_credits` were hand-seeded. Not one referral has ever been
      // credited. (Both statuses re-verified against prod on 2026-09-01.)
      //
      // The code now travels in the `complete-signup` body instead. That
      // function already establishes that the caller owns this account — a
      // 30-minute window from account creation, never-signed-in, and an empty
      // profile — and it runs service-role, so it does not need the session
      // that does not exist yet. It records the referral through
      // `record_referral_signup`, a service-role-only entry point that shares
      // one body with `process_referral` (migration 20260901035252), so the
      // two paths cannot drift apart.
      //
      // `process_referral` itself is unchanged and still granted to
      // `authenticated`: it remains the correct call from any surface that
      // DOES hold a session.
      const referralRecorded = (result as { referralRecorded?: boolean } | null)?.referralRecorded === true;

      track(AhaEvent.SignupCompleted, {
        provider: "email", // Apple/Google fire it from src/lib/socialSignupCompleted.ts (DQ-2)
        has_referral: !!referralCode.trim(),
        referral_recorded: referralRecorded,
        ...ppoTrackingProps(),
      });
      hapticSuccess();
      rememberPendingSignup(email); // owner 11-20: /signup says "Check your email to finish" until it is verified
      navigate("/signup-pending", { state: { email } });
    } catch (err: unknown) {
      hapticError();
      // Reported, not just toasted: this catch guards the whole signup funnel
      // (signUp → complete-signup → referral), and a failure here can
      // strand a HALF-CREATED account (auth user exists, profile incomplete)
      // with a 4-second toast as the only evidence. Observed live 2026-08-24.
      report(err, { tags: { source: "Signup.createAccountAndFinish" } });
      // Ask the auth vocabulary FIRST. userFacingError suppresses
      // machine-shaped strings, but GoTrue's are short lowercase prose
      // ("email rate limit exceeded", "user already registered") matching none
      // of its INTERNAL_PATTERNS — so they passed through verbatim and the
      // signup wall told people their EMAIL was rate limited, with no next
      // step. Observed live 2026-09-02, on the failure a launch-day queue makes
      // most likely. recognizedAuthError returns null when it has nothing to
      // say, so anything non-auth still gets the normal treatment below.
      //
      // userFacingError guarantees the raw text still reaches the console; on
      // the auth branch it is never called, so log it here rather than lose
      // the breadcrumb a bug report depends on.
      // AUD31-53: a server refusal of the password (weak_password: a leaked one, or a rule the client's list does
      // not know) shows its reason under the password field, never as a raw toast.
      if (isWeakPasswordError(err)) {
        setServerPasswordError(weakPasswordWords(err));
        return;
      }
      const authCopy = recognizedAuthError((err as { message?: string } | null | undefined)?.message);
      if (authCopy) console.error("[signup:auth]", err);
      setFormError(authCopy ?? userFacingError(err, t("signup.createFailed")));
    } finally {
      setLoading(false);
    }
  };

  // "Create account": the form's own checks ran in SignupStep1; this one re-checks, then creates the account.
  // One single-flight path (OA-002).
  const submit = async () => {
    if (submittingRef.current) return;
    submittingRef.current = true;
    setFormError(null);
    try {
      if (!(await validateAccountStep())) return;
      track(AhaEvent.SignupStepCompleted, { step: 1, ...ppoTrackingProps() }); // kept so the funnel dashboards still read
      await createAccountAndFinish();
    } finally {
      submittingRef.current = false;
    }
  };

  // Match the Login screen's field styling exactly so the two auth screens read as one set. (The `pl-10`/`pr-10`
  // icon padding is appended at each call site, mirroring Login.)
  const inputCls =
    "rounded-ds-md text-ellipsis bg-white/60 dark:bg-white/5 border-[hsl(var(--bark)/0.28)] dark:border-white/15 shadow-[inset_0_1px_2px_hsl(var(--ink-deep)/0.05)] placeholder:text-[hsl(var(--olivewood)/0.8)]";
  const labelCls = "text-ds-13 font-sans font-medium";

  // Subtitles only where they carry information: a reason line (e.g. "Create an account to get alerts"), else the
  // card's default.
  const subtitle = signupSubtitle(searchParams.get("reason"), searchParams.get("redirect"));

  // No `desktopBrandPanel`: the AuthBrandPane (deleted unused 2026-08-25) was only the H emblem, stacked ABOVE the form
  // at lg+ with the heading row's own emblem below: two marks, and the Google button pushed off a 922px-tall window.
  // One emblem now sits beside the heading at every width.
  return (
    <AuthShell
      hideHeader
      centerColumn
      // Board 55: the Log in card's width with its heading inside the card and no back (the H links home).
      maxWidth="sm"
      noWebChrome
      hideBack
    >
      {/* F024 (owner UI audit 11-09): 48px from the window's top edge from lg up (the shell's 24 + 24 here). */}
      <div className="lg:pt-6" data-signup-top="">
          {/* Liquid-glass card: matches Login's `.liquid-glass` card so the two auth screens read as one set. */}
          <div className="liquid-glass auth-card p-5 sm:p-6 lg:p-10 space-y-6">
        {/* Owner 11-20: a sign-up here already waits on its email. Its final step is the email, not a second form. */}
        {pendingSignup && (
          <PendingSignupCard email={pendingSignup.email} onUseDifferent={() => { clearPendingSignup(); setPendingSignup(null); }} />
        )}

        {/* The one sign-up form: names, email, password, agreements, "Create account". */}
        {!pendingSignup && (
          <SignupStep1
            firstName={firstName}
            setFirstName={setFirstName}
            lastName={lastName}
            setLastName={setLastName}
            email={email}
            setEmail={setEmail}
            password={password}
            setPassword={(v: string) => { setServerPasswordError(null); setPassword(v); }}
            serverPasswordError={serverPasswordError}
            showPassword={showPassword}
            setShowPassword={setShowPassword}
            acceptedPolicies={acceptedPolicies}
            setAcceptedPolicies={setAcceptedPolicies}
            ageConfirmed={ageConfirmed}
            setAgeConfirmed={setAgeConfirmed}
            marketingConsent={marketingConsent}
            setMarketingConsent={setMarketingConsent}
            referralCode={referralCode}
            setReferralCode={setReferralCode}
            inputCls={inputCls}
            labelCls={labelCls}
            subtitle={subtitle}
            captchaSlot={turnstile}
            loading={loading}
            formError={formError}
            onContinue={submit}
          />
        )}
        {/* "Already have an account? Sign in" lives in SignupStep1's social
            column (as Login's "New to Helpr?"); a second copy here rendered it twice. */}
          </div>
          {/* F025 (owner UI audit 11-09): English / Español sits UNDER the card, the same spot as on Log in
              (it was the last line inside the card here). */}
          <div className="flex justify-center pt-3" data-signup-language="">
            <LanguageToggle />
          </div>
      </div>
    </AuthShell>
  );
};

export default Signup;
