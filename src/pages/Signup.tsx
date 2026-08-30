import { useState, useEffect } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { usePageMeta } from "@/hooks/usePageMeta";
import { checkPasswordPwned } from "@/lib/hibpCheck";
import { track, AhaEvent } from "@/lib/analytics";
import { ppoTrackingProps } from "@/lib/ppoAttribution";
import { safeStorage } from "@/lib/safeStorage";
import { report } from "@/lib/errorLogger";
import AuthShell from "@/components/auth/AuthShell";
import { rememberJobIntent, rememberSignupRedirect, postAuthDestination } from "@/lib/jobIntent";
import { useAuthReady } from "@/hooks/useAuthReady";
import { hapticMedium, hapticSuccess, hapticError } from "@/lib/haptics";
import {
  ALLOWED_IMAGE_TYPES,
  SIGNUP_COOLDOWN_MS,
  SIGNUP_COOLDOWN_KEY,
  validateFile,
  fileToBase64,
  ageFromDob,
} from "./signup/signupHelpers";
import { SignupStep1 } from "./signup/SignupStep1";
import { SignupStep2 } from "./signup/SignupStep2";
import { getPublicOrigin } from "@/lib/authRedirects";

const Signup = () => {
  const navigate = useNavigate();
  usePageMeta({
    title: "Sign Up — Helpr",
    description: "Create your free Helpr account in under a minute.",
    canonical: "https://www.louisianahelpr.com/signup",
    ogTitle: "Sign Up — Helpr",
    ogDescription: "Join Helpr in under a minute and start posting jobs or earning as a verified Helpr across Louisiana.",
  });
  const { user, isReady } = useAuthReady();
  const [searchParams] = useSearchParams();
  // `?job=<id>` — the job a guest tapped on /browse or /jobs before the signup
  // wall. `?redirect=<path>` — the fuller form of the same idea: the exact
  // in-app route they were trying to reach (e.g. `/jobs/<id>`). Persist both
  // immediately, because signup does not end here: it ends at /signup-pending
  // and then in the visitor's email client, and neither router state nor a
  // query param survives that round-trip. See lib/jobIntent.
  //
  // SECURITY: `redirect` is attacker-controllable. `rememberSignupRedirect`
  // drops anything that isn't a same-origin path, so a crafted
  // `/signup?redirect=https://evil.com` stores nothing and the flow falls back
  // to its normal landing.
  const pendingJobId = searchParams.get("job");
  const pendingRedirect = searchParams.get("redirect");
  //
  // NOTE ON ORDER: this effect is declared BEFORE the already-authenticated
  // bounce below on purpose. Both fire on the mount commit, in declaration
  // order, and the bounce reads the value this one writes.
  useEffect(() => {
    if (pendingJobId) rememberJobIntent(pendingJobId);
    rememberSignupRedirect(pendingRedirect);
  }, [pendingJobId, pendingRedirect]);
  // An already-authenticated visitor has no business on the signup form —
  // bounce them into the app. Wait for isReady so we don't redirect on the
  // pre-bootstrap null snapshot.
  useEffect(() => {
    if (isReady && user) navigate(postAuthDestination(), { replace: true });
  }, [isReady, user, navigate]);
  // Funnel event: user landed on signup page (top of activation funnel)
  useEffect(() => {
    track(AhaEvent.SignupStarted, { source: "web", ...ppoTrackingProps() });
  }, []);
  // Dev-only: seed the step from `?step=2` so the flow can be inspected
  // without the old on-page PREVIEW band, which showed testers a control
  // real users never see. Production always starts at step 1.
  const [step, setStep] = useState(() => {
    if (!import.meta.env.DEV) return 1;
    const n = Number(new URLSearchParams(window.location.search).get("step"));
    return n === 2 ? 2 : 1;
  });
  const [loading, setLoading] = useState(false);

  // Step 1 fields
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const fullName = `${firstName.trim()} ${lastName.trim()}`.trim();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [phone, setPhone] = useState("");
  const [dateOfBirth, setDateOfBirth] = useState("");
  const [location, setLocation] = useState("");
  // Referral code is captured only from the `?ref=` deep link now (the manual
  // entry field lived on the removed Step 3). process_referral just records the
  // link at signup; the $5 credit is released by a DB trigger when the referred
  // user posts or completes their first job.
  const [referralCode] = useState(searchParams.get("ref") || "");
  const [acceptedPolicies, setAcceptedPolicies] = useState(false);
  // Explicit 18+ attestation — a legal requirement on a real-money platform.
  // DOB is deferred to first post/apply, so this checkbox is what satisfies the
  // age gate at account creation (server enforces it too via ageAttested).
  const [ageConfirmed, setAgeConfirmed] = useState(false);
  // Marketing / promotional email opt-in — UNCHECKED by default so a user
  // who doesn't tick it never gets marketing mail. Persists to
  // profiles.marketing_consent via complete-signup below; the marketing
  // sender filters on it.
  const [marketingConsent, setMarketingConsent] = useState(false);
  const [showPassword, setShowPassword] = useState(false);

  // Step 2 fields
  const [bio, setBio] = useState("");
  const [avatarFile, setAvatarFile] = useState<File | null>(null);
  const [avatarPreview, setAvatarPreview] = useState<string | null>(null);

  // Step 2 inline field errors — populated on Continue tap, cleared as user fixes each field
  const [step2Errors, setStep2Errors] = useState<Record<string, string>>({});

  const handleAvatarChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file && validateFile(file, ALLOWED_IMAGE_TYPES, "Profile picture")) {
      setAvatarFile(file);
      setAvatarPreview(URL.createObjectURL(file));
    }
  };


  // Validates the "About you" content (UI step 2, the final step).
  // Collects ALL field errors at once so the user sees every problem on a
  // single Continue tap — no more "fix one, tap again, get next error" loop.
  const validateAboutYouStep = async () => {
    const errors: Record<string, string> = {};

    if (!firstName.trim()) errors.firstName = "Add your first name";
    if (!lastName.trim()) errors.lastName = "Add your last name";
    // Avatar and phone are REQUIRED (owner decision 2026-08-29, reversing the
    // prior "deferred to keep signup under a minute" choice) — both carry a
    // red asterisk on their labels, so the validator must actually enforce
    // them, same as DOB below. Bio remains optional/deferred.
    if (!avatarFile) errors.avatar = "Add a profile photo";
    if (!phone.trim()) {
      errors.phone = "Add your phone number";
    } else if (phone.replace(/\D/g, "").length < 10) {
      errors.phone = "Enter a valid 10-digit phone number";
    }
    // DOB is REQUIRED (it carries a red asterisk on the label, so the
    // validator must actually enforce it — a marker the form doesn't honour is
    // worse than no marker). Age is still checked when a value is present.
    if (!dateOfBirth) {
      errors.dateOfBirth = "Add your date of birth";
    } else if (ageFromDob(dateOfBirth) < 18) {
      errors.dateOfBirth = "You'll need to be 18 or older to join.";
    }
    // City is REQUIRED (owner decision 2026-08-29) — collecting it here means
    // an email signup satisfies the full CompleteProfile gate (name, photo,
    // DOB, phone, city) and skips /complete-profile entirely; only Google/
    // Apple sign-ins, which never see this step, still land on it.
    if (!location.trim()) errors.location = "Add your city";
    // Bio is optional — but if the user starts one, keep the 20-char floor so
    // a half-typed sentence doesn't ship as their whole profile.
    if (bio.trim().length > 0 && bio.trim().length < 20) errors.bio = "Add at least 20 characters, or leave it blank for now";

    // Async phone-duplicate check — only runs when all synchronous checks pass,
    // so we don't waste a round-trip when there are obvious local errors.
    //
    // NOTE: `profiles.phone` stores the formatted value produced by
    // `formatPhone` (e.g. "(504) 555-1234"), not a digits-only string —
    // see signupHelpers.ts:62-72 and the unmodified pass-through in
    // complete-signup/index.ts. So an `.eq("phone", digits)` comparison
    // never matches and duplicate-phone signups slip through.
    //
    // Match the last 7 digits via `ilike` instead — tolerant of historical
    // formatting variations and area-code typos, and matches behavior from
    // before the (now-broken) "normalize to digits" change.
    const normalizedPhone = phone.replace(/\D/g, "").slice(-10);
    if (Object.keys(errors).length === 0 && normalizedPhone.length === 10) {
      const lastSeven = normalizedPhone.slice(-7);
      // Fail CLOSED. Dropping this error let the duplicate-phone gate silently
      // OPEN on any query failure (RLS change, timeout), which is the one
      // outcome it exists to prevent. Block with a retryable message instead of
      // waving a possible duplicate account through.
      const { data: existing, error: existingError } = await supabase
        .from("profiles")
        .select("user_id")
        .ilike("phone", `%${lastSeven}%`)
        .limit(5);
      if (existingError) {
        report("signup.phoneDedupe.lookupFailed", {
          severity: "warning",
          tags: { source: "Signup.phoneDedupe" },
          context: { message: existingError.message },
        });
        errors.phone = "We couldn't verify this phone number just now. Please try again.";
      } else if (existing && existing.length > 0) {
        errors.phone = "This phone number is already associated with an account. Please log in instead.";
        // Monitor false-positive rate — multiple matches likely means our
        // last-7-digit heuristic is too loose for this number.
        if (existing.length > 1) {
          report("signup.phoneDedupe.multipleMatches", {
            severity: "warning",
            tags: { source: "Signup.phoneDedupe" },
            context: { matchCount: existing.length, lastSevenSuffix: lastSeven.slice(-4) },
          });
        }
      }
    }

    setStep2Errors(errors);
    if (Object.keys(errors).length > 0) {
      track(AhaEvent.SignupStepValidationFailed, {
        step: 2,
        error_fields: Object.keys(errors),
        ...ppoTrackingProps(),
      });
      return false;
    }
    return true;
  };

  // Validates the "Account credentials + agreements" content (UI step 1).
  const validateAccountStep = async () => {
    if (!email.trim()) { toast.error("Add your email address."); return false; }
    if (password.length < 8) { toast.error("Password needs at least 8 characters."); return false; }
    if (!/[A-Z]/.test(password)) { toast.error("Add at least one uppercase letter to your password."); return false; }
    if (!/[0-9]/.test(password)) { toast.error("Add at least one number to your password."); return false; }
    if (!acceptedPolicies) { toast.error("Check the box to agree to the terms and platform rules."); return false; }
    if (!ageConfirmed) { toast.error("Check the box to confirm you're 18 or older."); return false; }
    return true;
  };


  const completeProfile = async (userId: string) => {
    const avatarBase64 = avatarFile ? await fileToBase64(avatarFile) : null;
    const avatarExt = avatarFile ? avatarFile.name.split(".").pop() : null;

    // The optional profile extras that used to be collected on Step 3 are
    // handled two different ways now, and the difference matters:
    //   • Skills, credentials and portfolio are added later from Edit Profile,
    //     which has an input for each.
    //   • Hourly rate is NOT — it was retired 2026-08-27 (poster-set pricing),
    //     so nothing in the app ever sets it and no editor is coming.
    // Either way the edge function defaults every omitted field to null, same
    // as a skip.
    const { data: result, error: fnError } = await supabase.functions.invoke("complete-signup", {
      body: {
        userId,
        avatarBase64,
        avatarExt,
        avatarContentType: avatarFile?.type,
        phone,
        bio,
        location,
        dateOfBirth: dateOfBirth || null,
        // Explicit marketing-email consent captured at signup. Defaults to
        // false server-side; passing it here lets a user who ticked the box
        // opt in at account-creation time.
        marketingConsent,
        // 18+ attestation. DOB is deferred, so this is what satisfies the
        // server's legal age gate on the initial completion path.
        ageAttested: ageConfirmed,
      },
    });

    if (fnError) {
      throw new Error(fnError.message || "We couldn't save your signup details.");
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
      toast.error(`Too many attempts — try again in ${secsLeft}s.`);
      setLoading(false);
      return;
    }
    try {
      // HIBP breached-password check (k-anonymity, fail-open on network error)
      const pwnedCount = await checkPasswordPwned(password);
      if (pwnedCount !== null && pwnedCount > 0) {
        toast.error(
          `This password has appeared in ${pwnedCount.toLocaleString()} known data breaches. Please choose a different password.`
        );
        setLoading(false);
        return;
      }

      // Arm the cooldown only once a real signUp attempt fires. Arming it up
      // front (pre-HIBP, pre-phone-check) punished the user whose password or
      // phone was REJECTED locally with a 60s "Too many attempts" on the very
      // retry that would have fixed it.
      safeStorage.setItem(SIGNUP_COOLDOWN_KEY, String(Date.now()));

      const { data: authData, error: authError } = await supabase.auth.signUp({
        email,
        password,
        options: {
          emailRedirectTo: `${getPublicOrigin()}/account-pending`,
          data: { full_name: fullName },
        },
      });

      if (authError && (authError.message.includes("already registered") || authError.message.includes("already been registered"))) {
        // Privacy-first: never confess whether an email is registered.
        // Cowork audit 2026-07-08 flagged the old "please log in" branch
        // as an enumeration oracle inconsistent with ForgotPassword's
        // generic-success pattern. Both flows now respond identically —
        // an attacker probing signup vs reset can't tell either way
        // whether the address exists. A real logged-out user who
        // stumbles into this path is redirected to /login with the
        // same generic message they'd see on ForgotPassword — set here,
        // read-and-cleared by Login. Without it the user pressed "Create
        // account" and silently arrived on a different screen.
        try { sessionStorage.setItem("helpr_signup_redirect", "1"); } catch { /* private mode */ }
        navigate("/login");
        return;
      }
      if (authError) throw authError;
      const userId = authData.user?.id;
      if (!userId) throw new Error("Account creation failed");

      // Complete profile with uploads (no ID — Stripe handles identity)
      await completeProfile(userId);

      // Process referral code if provided. supabase-js resolves errors into
      // `{ error }` rather than throwing, so a try/catch never sees them —
      // read the error explicitly (referral credit is best-effort, log only).
      if (referralCode.trim()) {
        const { error: referralErr } = await supabase.rpc("process_referral", {
          p_referral_code: referralCode.trim().toUpperCase(),
          p_new_user_id: userId,
        });
        if (referralErr) report(referralErr, { tags: { source: "Signup.referral" } });
      }


      track(AhaEvent.SignupCompleted, { has_referral: !!referralCode.trim(), ...ppoTrackingProps() });
      hapticSuccess();
      navigate("/signup-pending", { state: { email } });
    } catch (err: any) {
      hapticError();
      // Reported, not just toasted: this catch guards the whole signup funnel
      // (signUp → complete-signup → referral), and a failure here can
      // strand a HALF-CREATED account (auth user exists, profile incomplete)
      // with a 4-second toast as the only evidence. Observed live 2026-08-24.
      report(err, { tags: { source: "Signup.createAccountAndFinish" } });
      toast.error(err.message || "Couldn't create your account — try again?");
    } finally {
      setLoading(false);
    }
  };

  // Match the Login screen's field styling exactly so the two auth screens
  // read as one set. (The `pl-10`/`pr-10` icon padding is appended at each
  // call site, mirroring Login.)
  const inputCls =
    "rounded-ds-md bg-white/60 dark:bg-white/5 border-[hsl(var(--bark)/0.28)] dark:border-white/15 shadow-[inset_0_1px_2px_hsl(var(--ink-deep)/0.05)] placeholder:text-[hsl(var(--olivewood)/0.8)]";
  const labelCls = "text-ds-13 font-sans font-medium";

  // Subtitles only where they carry information. Step 1 drops its
  // "Create your account to get started." — the email/password form directly
  // below already says that, the same reason Login's
  // "Pick up right where you left off." was removed. `subtitle` is optional;
  // the header renders the <p> only when one is present.
  const stepHeading: { title: string; subtitle?: string } =
    step === 1 ? { title: "Create Account" } : { title: "About You" };

  // No `desktopBrandPanel`: the AuthBrandPane component (deleted unused on
  // 2026-08-25) was only the H emblem, and it stacked
  // ABOVE the form at lg+ while the heading row carried its own emblem below —
  // two marks, plus a tall vertical stack that pushed the Google button off the
  // bottom of a 922px-tall window. One emblem now sits beside the heading at
  // every width.
  return (
    <AuthShell
      hideHeader
      centerColumn
      maxWidth="2xl"
      noWebChrome
      // Step 1 exits to home; step 2 walks the wizard back rather than leaving
      // the page, because exiting from step 2 discards the credentials already
      // typed. Both render through the SAME shell row, so the two steps no
      // longer differ in title size (step 2 used to be a hand-rolled row inside
      // the card at clamp(1.6rem,2.4vw+0.5rem,2.1rem) against step 1's ds-24).
      {...(step === 1 ? { backTo: "/" } : { backOnClick: () => { setStep2Errors({}); setStep(1); } })}
      title={step === 1 ? "Create Account" : stepHeading.title}
    >
      <div>
          {/* Liquid-glass card — matches the Login screen so the two auth
              screens read as one set (see Login.tsx's `.liquid-glass` card). */}
          <div className="liquid-glass p-5 sm:p-6 lg:p-10 space-y-6">
            {/* No heading inside the card. Both steps' [back] [title] rows are
                now AuthShell's `title` row above it. The subtitle stays — it is
                supporting copy for the card, not a heading.

                Rendered WITHOUT a wrapper div. It previously sat inside
                `<div className="text-left space-y-1">`, which on step 1 (no
                subtitle) rendered an EMPTY div that still counted as a child of
                the card's `space-y-6` — so Create Account opened with 24px more
                air above the Email field than Sign In did, on two cards that are
                otherwise the same component. An empty element is invisible;
                the gap it reserves is not. */}
            {stepHeading.subtitle && (
              <p
                className="font-sans text-ds-15 text-left"
                style={{
                  color: "hsl(var(--olivewood) / 0.8)",
                  letterSpacing: "0.01em",
                }}
              >
                {stepHeading.subtitle}
              </p>
            )}

        {/* Step 2: About you + ID */}
        {step === 2 && (
          <SignupStep2
            avatarPreview={avatarPreview}
            onAvatarChange={handleAvatarChange}
            firstName={firstName}
            setFirstName={setFirstName}
            lastName={lastName}
            setLastName={setLastName}
            phone={phone}
            setPhone={setPhone}
            dateOfBirth={dateOfBirth}
            setDateOfBirth={setDateOfBirth}
            location={location}
            setLocation={setLocation}
            bio={bio}
            setBio={setBio}
            inputCls={inputCls}
            labelCls={labelCls}
            fieldErrors={step2Errors}
            clearFieldError={(key) => setStep2Errors((prev) => { const next = { ...prev }; delete next[key]; return next; })}
            loading={loading}
            onContinue={async () => {
              if (!(await validateAboutYouStep())) return;
              setStep2Errors({});
              track(AhaEvent.SignupStepCompleted, { step: 2, ...ppoTrackingProps() });
              await createAccountAndFinish();
            }}
          />
        )}

        {/* Step 1: Account credentials + agreements */}
        {step === 1 && (
          <SignupStep1
            email={email}
            setEmail={setEmail}
            password={password}
            setPassword={setPassword}
            showPassword={showPassword}
            setShowPassword={setShowPassword}
            acceptedPolicies={acceptedPolicies}
            setAcceptedPolicies={setAcceptedPolicies}
            ageConfirmed={ageConfirmed}
            setAgeConfirmed={setAgeConfirmed}
            marketingConsent={marketingConsent}
            setMarketingConsent={setMarketingConsent}
            inputCls={inputCls}
            labelCls={labelCls}
            onContinue={async () => {
              if (!(await validateAccountStep())) return;
              track(AhaEvent.SignupStepCompleted, { step: 1, ...ppoTrackingProps() });
              setStep(2);
            }}
          />
        )}
        {/* "Already have an account? Sign in" used to live here, guarded by
            `step === 1`. It now closes SignupStep1's social column, where it
            reads as the alternative to BOTH create-account methods (the mirror
            of Login's "New to Helpr?"). Keeping this copy as well rendered the
            link TWICE on step 1 — once mid-card, once again at the bottom.
            Step 2 never mounts SignupStep1, so the old `step === 1` guard is
            now structural rather than a condition to remember. */}
          </div>
      </div>
    </AuthShell>
  );
};

export default Signup;
