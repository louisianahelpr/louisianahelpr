import { useState, useEffect } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { usePageMeta } from "@/hooks/usePageMeta";
import { checkPasswordPwned } from "@/lib/hibpCheck";
import { track, AhaEvent } from "@/lib/analytics";
import { ppoTrackingProps } from "@/lib/ppoAttribution";
import { safeStorage } from "@/lib/safeStorage";
import { report } from "@/lib/errorLogger";
import AuthShell from "@/components/auth/AuthShell";
import HelprMark from "@/components/HelprMark";
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

// TEMP: forced on for sim testing so every step is tappable in a production
// (non-DEV) build. Set back to false before commit — the jumper then shows
// only in real dev builds via `import.meta.env.DEV` below.
const FORCE_STEP_JUMPER = false;

const Signup = () => {
  const navigate = useNavigate();
  usePageMeta({
    title: "Sign Up — Helpr",
    description: "Create your free Helpr account in under a minute.",
    canonical: "https://www.louisianahelpr.com/signup",
    ogTitle: "Sign Up — Helpr",
    ogDescription: "Join Helpr in under a minute and start posting jobs or earning as a verified Helpr across Louisiana.",
  });
  // An already-authenticated visitor has no business on the signup form —
  // bounce them into the app. Wait for isReady so we don't redirect on the
  // pre-bootstrap null snapshot.
  const { user, isReady } = useAuthReady();
  useEffect(() => {
    if (isReady && user) navigate("/dashboard", { replace: true });
  }, [isReady, user, navigate]);
  // Funnel event: user landed on signup page (top of activation funnel)
  useEffect(() => {
    track(AhaEvent.SignupStarted, { source: "web", ...ppoTrackingProps() });
  }, []);
  const [searchParams] = useSearchParams();
  const isBusinessSignup = searchParams.get("type") === "business";
  const [companyName, setCompanyName] = useState("");
  const [step, setStep] = useState(1);
  const [loading, setLoading] = useState(false);

  // Step 1 fields
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const fullName = `${firstName.trim()} ${lastName.trim()}`.trim();
  // Prefill email when arriving via a business team invite link.
  // The pending business_members row's invited_email is matched to the
  // signing-up user's email by the post-signup auto-claim flow, so the
  // prefill needs to lock in the invite-target address.
  const inviteEmail = searchParams.get("invite") || "";
  const [email, setEmail] = useState(inviteEmail);
  const [password, setPassword] = useState("");
  const [phone, setPhone] = useState("");
  const [dateOfBirth, setDateOfBirth] = useState("");
  // Referral code is captured only from the `?ref=` deep link now (the manual
  // entry field lived on the removed Step 3). process_referral just records the
  // link at signup; the $5 credit is released by a DB trigger when the referred
  // user posts or completes their first job.
  const [referralCode] = useState(searchParams.get("ref") || "");
  const [acceptedPolicies, setAcceptedPolicies] = useState(false);
  const [showPassword, setShowPassword] = useState(false);

  // Step 2 fields
  const [bio, setBio] = useState("");
  const [location, setLocation] = useState("");
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

    if (isBusinessSignup && !companyName.trim()) errors.companyName = "Company name is required";
    if (!avatarFile) errors.avatar = "Profile picture is required";
    if (!firstName.trim()) errors.firstName = "First name is required";
    if (!lastName.trim()) errors.lastName = "Last name is required";
    if (!phone.trim()) {
      errors.phone = "Phone number is required";
    } else if (phone.replace(/\D/g, "").length < 10) {
      errors.phone = "Enter a valid 10-digit phone number";
    }
    if (!dateOfBirth) {
      errors.dateOfBirth = "Date of birth is required";
    } else if (ageFromDob(dateOfBirth) < 18) {
      errors.dateOfBirth = "You must be at least 18 years old to sign up";
    }
    if (!location.trim()) errors.location = "City is required";
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
      const { data: existing } = await supabase
        .from("profiles")
        .select("user_id")
        .ilike("phone", `%${lastSeven}%`)
        .limit(5);
      if (existing && existing.length > 0) {
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
    if (!email.trim()) { toast.error("Email is required"); return false; }
    if (password.length < 8) { toast.error("Password must be at least 8 characters"); return false; }
    if (!/[A-Z]/.test(password)) { toast.error("Password must contain at least one uppercase letter"); return false; }
    if (!/[0-9]/.test(password)) { toast.error("Password must contain at least one number"); return false; }
    if (!acceptedPolicies) { toast.error("You must agree to the terms, platform rules, and privacy policy"); return false; }
    return true;
  };


  const completeProfile = async (userId: string) => {
    const avatarBase64 = avatarFile ? await fileToBase64(avatarFile) : null;
    const avatarExt = avatarFile ? avatarFile.name.split(".").pop() : null;

    // The optional profile extras (skills, credentials, portfolio, etc.) that
    // used to be collected on Step 3 are now added later from Profile — the
    // edge function defaults every omitted field to null, same as a skip.
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
      toast.error(`Please wait ${secsLeft} seconds before trying again`);
      setLoading(false);
      return;
    }
    safeStorage.setItem(SIGNUP_COOLDOWN_KEY, String(Date.now()));

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

      const { data: authData, error: authError } = await supabase.auth.signUp({
        email,
        password,
        options: {
          emailRedirectTo: `${window.location.origin}/account-pending`,
          data: { full_name: fullName },
        },
      });

      if (authError && (authError.message.includes("already registered") || authError.message.includes("already been registered"))) {
        // An account already exists for this email — route to login instead
        // of showing a fake "success" toast and a /signup-pending page the
        // user never actually receives a verification email for.
        toast.info("You already have an account with this email — please log in.");
        navigate("/login");
        return;
      }
      if (authError) throw authError;
      const userId = authData.user?.id;
      if (!userId) throw new Error("Account creation failed");

      // Complete profile with uploads (no ID — Stripe handles identity)
      await completeProfile(userId);

      // Process referral code if provided
      if (referralCode.trim()) {
        try {
          await supabase.rpc("process_referral", {
            p_referral_code: referralCode.trim().toUpperCase(),
            p_new_user_id: userId,
          });
        } catch (e) { report(e, { tags: { source: "Signup.referral" } }); }
      }

      // Business signup: create business
      if (isBusinessSignup && companyName.trim()) {
        try {
          await supabase.from("businesses").insert({
            owner_id: userId,
            name: companyName.trim(),
          });
        } catch (e) { report(e, { tags: { source: "Signup.businessCreation" } }); }
      }

      // Auto-accept any pending invite for this email
      try {
        const { data: invites, error: inviteErr } = await supabase.rpc("get_pending_invite_for_email", { _email: email });
        // PGRST202 = function not yet deployed to production — safe to ignore
        // (invite-linking is best-effort; the user can still join the team
        // manually after login). All other errors are logged for observability.
        if (inviteErr && !inviteErr.message?.includes("PGRST202")) {
          report(inviteErr, { tags: { source: "Signup.inviteLinking" } });
        }
        if (invites && invites.length > 0) {
          for (const inv of invites) {
            await supabase
              .from("business_members")
              .update({ user_id: userId, status: "active", joined_at: new Date().toISOString() })
              .eq("id", inv.invite_id);
          }
        }
      } catch (e) { report(e, { tags: { source: "Signup.inviteLinking" } }); }

      track(AhaEvent.SignupCompleted, { has_referral: !!referralCode.trim(), ...ppoTrackingProps() });
      hapticSuccess();
      toast.success("Account created! Check your email and click the verification link to continue.");
      navigate("/signup-pending", { state: { email } });
    } catch (err: any) {
      hapticError();
      toast.error(err.message || "Signup failed");
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

  // Short, single-line titles that mirror the Login screen's heading,
  // each paired with a brief subtitle (kept, per request, but trimmed).
  const stepHeading =
    step === 1
      ? isBusinessSignup
        ? { title: "Set up your business.", subtitle: "Invite your team and bill jobs to one card." }
        : { title: "Welcome, neighbor.", subtitle: "Create your account to get started." }
      : { title: "Tell us about you.", subtitle: "A few basics so neighbors know who they're working with." };

  return (
    <AuthShell hideHeader>
      <div className="text-center mb-4 space-y-1.5">
        <div className="flex justify-center mb-2">
          <HelprMark to={null} size="md" emblemOnly />
        </div>
        <h1
          className="font-display italic font-bold leading-tight"
          style={{
            fontSize: "clamp(1.85rem, 3vw + 0.5rem, 2.5rem)",
            color: "hsl(var(--ink-deep))",
            letterSpacing: "-0.03em",
          }}
        >
          {stepHeading.title}
        </h1>
        <p
          className="font-sans"
          style={{
            fontSize: "0.95rem",
            color: "hsl(var(--olivewood) / 0.8)",
            letterSpacing: "0.01em",
          }}
        >
          {stepHeading.subtitle}
        </p>
      </div>
      <div className="pb-8">
          {/* Liquid-glass card — matches the Login screen so the two auth
              screens read as one set (see Login.tsx's `.liquid-glass` card). */}
          <div className="liquid-glass px-6 sm:px-8 py-5 space-y-4">
            {/* Dev-only step jumper — visible in dev builds so you can click through every signup screen without making an account. Hidden in production. */}
            {/* TEMP: FORCE_STEP_JUMPER forces this on for sim testing — set it to false before commit */}
            {(import.meta.env.DEV || FORCE_STEP_JUMPER) && (
              <div className="rounded-ds-sm border border-dashed border-primary/40 bg-primary/5 p-2 flex items-center gap-2 text-ds-11">
                <span className="text-primary font-semibold uppercase tracking-wider">Preview</span>
                <span className="text-muted-foreground">Jump to step:</span>
                {[1, 2].map((n) => (
                  <button
                    key={n}
                    type="button"
                    onClick={() => setStep(n)}
                    className={`w-6 h-6 rounded-md text-ds-11 font-semibold transition-colors ${
                      step === n
                        ? "bg-primary text-primary-foreground"
                        : "bg-card text-foreground"
                    }`}
                  >
                    {n}
                  </button>
                ))}
                <Link to="/signup-pending" className="ml-auto text-primary hover:underline">
                  Pending →
                </Link>
              </div>
            )}

        {/* Step 2: About you + ID */}
        {step === 2 && (
          <SignupStep2
            isBusinessSignup={isBusinessSignup}
            companyName={companyName}
            setCompanyName={setCompanyName}
            avatarFile={avatarFile}
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
            onBack={() => { setStep2Errors({}); setStep(1); }}
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
            inputCls={inputCls}
            labelCls={labelCls}
            isBusinessSignup={isBusinessSignup}
            onContinue={async () => {
              if (!(await validateAccountStep())) return;
              track(AhaEvent.SignupStepCompleted, { step: 1, ...ppoTrackingProps() });
              setStep(2);
            }}
          />
        )}
          </div>
      </div>
    </AuthShell>
  );
};

export default Signup;
