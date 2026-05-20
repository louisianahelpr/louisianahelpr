import { useState, useEffect } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { BadgeCheck } from "lucide-react";
import { usePageMeta } from "@/hooks/usePageMeta";
import { checkPasswordPwned } from "@/lib/hibpCheck";
import { track, AhaEvent } from "@/lib/analytics";
import { ppoTrackingProps } from "@/lib/ppoAttribution";
import { safeStorage } from "@/lib/safeStorage";
import { report } from "@/lib/errorLogger";
import AuthShell from "@/components/auth/AuthShell";
import { hapticMedium, hapticSuccess, hapticError } from "@/lib/haptics";
import {
  ALLOWED_IMAGE_TYPES,
  ALLOWED_DOC_TYPES,
  SIGNUP_COOLDOWN_MS,
  SIGNUP_COOLDOWN_KEY,
  validateFile,
  fileToBase64,
  ageFromDob,
} from "./signup/signupHelpers";
import { SignupStep1 } from "./signup/SignupStep1";
import { SignupStep2 } from "./signup/SignupStep2";
import { SignupStep3 } from "./signup/SignupStep3";

const Signup = () => {
  const navigate = useNavigate();
  usePageMeta({
    title: "Sign Up — Helpr",
    description: "Create your free Helpr account in under a minute.",
    canonical: "https://www.louisianahelpr.com/signup",
    ogTitle: "Sign Up — Helpr",
    ogDescription: "Join Helpr in under a minute and start posting tasks or earning as a verified helper across Louisiana.",
  });
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
  const [skillSearch, setSkillSearch] = useState("");
  // Prefill email when arriving via a business team invite link.
  // The pending business_members row's invited_email is matched to the
  // signing-up user's email by the post-signup auto-claim flow, so the
  // prefill needs to lock in the invite-target address.
  const inviteEmail = searchParams.get("invite") || "";
  const [email, setEmail] = useState(inviteEmail);
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [phone, setPhone] = useState("");
  const [dateOfBirth, setDateOfBirth] = useState("");
  const [referralCode, setReferralCode] = useState(searchParams.get("ref") || "");
  const [acceptedPolicies, setAcceptedPolicies] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);

  // Step 2 fields
  const [bio, setBio] = useState("");
  const [location, setLocation] = useState("");
  const [skills, setSkills] = useState("");
  const [availability, setAvailability] = useState<string[]>([]);
  const [transportation] = useState("");
  const [hearAboutUs, setHearAboutUs] = useState("");
  const [experienceLevel, setExperienceLevel] = useState("");
  const [toolsEquipment, setToolsEquipment] = useState<string[]>([]);
  const [emergencyContactName, setEmergencyContactName] = useState("");
  const [emergencyContactPhone, setEmergencyContactPhone] = useState("");
  const [jobRadius, setJobRadius] = useState("");
  const [extraComments, setExtraComments] = useState("");
  const [avatarFile, setAvatarFile] = useState<File | null>(null);
  const [avatarPreview, setAvatarPreview] = useState<string | null>(null);

  // Step 2 inline field errors — populated on Continue tap, cleared as user fixes each field
  const [step2Errors, setStep2Errors] = useState<Record<string, string>>({});

  // Step 3 fields - Portfolio / Documents
  const [portfolioFiles, setPortfolioFiles] = useState<File[]>([]);
  const [portfolioPreviews, setPortfolioPreviews] = useState<{ name: string; type: string; url: string }[]>([]);
  const [idFile, setIdFile] = useState<File | null>(null);
  const [idPreview, setIdPreview] = useState<string | null>(null);

  // Step 3 — Professional credentials (optional)
  const [isLicensed, setIsLicensed] = useState(false);
  const [licenseFile, setLicenseFile] = useState<File | null>(null);
  const [licensePreview, setLicensePreview] = useState<string | null>(null);
  const [isInsured, setIsInsured] = useState(false);
  const [insuranceFile, setInsuranceFile] = useState<File | null>(null);
  const [insurancePreview, setInsurancePreview] = useState<string | null>(null);

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

  const handleLicenseChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file && validateFile(file, ALLOWED_DOC_TYPES, "License document")) {
      setLicenseFile(file);
      setLicensePreview(file.type.startsWith("image/") ? URL.createObjectURL(file) : null);
    }
  };

  const handleInsuranceChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file && validateFile(file, ALLOWED_DOC_TYPES, "Insurance document")) {
      setInsuranceFile(file);
      setInsurancePreview(file.type.startsWith("image/") ? URL.createObjectURL(file) : null);
    }
  };

  const handlePortfolioSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    if (portfolioFiles.length + files.length > 10) {
      toast.error("Maximum 10 files allowed");
      return;
    }
    const newFiles = [...portfolioFiles, ...files].slice(0, 10);
    setPortfolioFiles(newFiles);
    setPortfolioPreviews(
      newFiles.map((f) => ({
        name: f.name,
        type: f.type,
        url: f.type.startsWith("image/") ? URL.createObjectURL(f) : "",
      }))
    );
  };

  const removePortfolioFile = (index: number) => {
    const newFiles = portfolioFiles.filter((_, i) => i !== index);
    setPortfolioFiles(newFiles);
    setPortfolioPreviews(
      newFiles.map((f) => ({
        name: f.name,
        type: f.type,
        url: f.type.startsWith("image/") ? URL.createObjectURL(f) : "",
      }))
    );
  };


  // Validates the "About you + ID" content (rendered as UI step 2).
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
    if (!bio.trim() || bio.trim().length < 20) errors.bio = "About you must be at least 20 characters";
    if (!idFile) errors.idFile = "Please upload a government-issued ID to continue";

    // Async phone-duplicate check — only runs when all synchronous checks pass,
    // so we don't waste a round-trip when there are obvious local errors.
    const normalizedPhone = phone.replace(/\D/g, "").slice(-10);
    if (Object.keys(errors).length === 0 && normalizedPhone.length === 10) {
      const { data: existing } = await supabase
        .from("profiles")
        .select("id")
        .eq("phone", normalizedPhone)
        .limit(1);
      if (existing && existing.length > 0) {
        errors.phone = "This phone number is already associated with an account. Please log in instead.";
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
    if (password !== confirmPassword) { toast.error("Passwords do not match"); return false; }
    if (!acceptedPolicies) { toast.error("You must agree to the platform rules, terms, and privacy policy"); return false; }
    return true;
  };


  const prepareFileData = async () => {
    const avatarBase64 = avatarFile ? await fileToBase64(avatarFile) : null;
    const avatarExt = avatarFile ? avatarFile.name.split(".").pop() : null;

    const idBase64 = idFile ? await fileToBase64(idFile) : null;
    const idExt = idFile ? idFile.name.split(".").pop() : null;

    const licenseBase64 = licenseFile ? await fileToBase64(licenseFile) : null;
    const licenseExt = licenseFile ? licenseFile.name.split(".").pop() : null;

    const insuranceBase64 = insuranceFile ? await fileToBase64(insuranceFile) : null;
    const insuranceExt = insuranceFile ? insuranceFile.name.split(".").pop() : null;

    const portfolioData = [];
    for (const file of portfolioFiles) {
      portfolioData.push({
        base64: await fileToBase64(file),
        ext: file.name.split(".").pop(),
        contentType: file.type,
      });
    }

    return { avatarBase64, avatarExt, idBase64, idExt, licenseBase64, licenseExt, insuranceBase64, insuranceExt, portfolioData };
  };

  const completeProfile = async (userId: string) => {
    const { avatarBase64, avatarExt, idBase64, idExt, licenseBase64, licenseExt, insuranceBase64, insuranceExt, portfolioData } = await prepareFileData();

    const { data: result, error: fnError } = await supabase.functions.invoke("complete-signup", {
      body: {
        userId,
        avatarBase64,
        avatarExt,
        avatarContentType: avatarFile?.type,
        idBase64,
        idExt,
        idContentType: idFile?.type,
        licenseBase64,
        licenseExt,
        licenseContentType: licenseFile?.type,
        isLicensed,
        insuranceBase64,
        insuranceExt,
        insuranceContentType: insuranceFile?.type,
        isInsured,
        portfolioFiles: portfolioData,
        phone,
        bio,
        location,
        skills: skills || null,
        dateOfBirth: dateOfBirth || null,
        availability: availability.length > 0 ? availability.join(", ") : null,
        transportation: transportation || null,
        hearAboutUs: hearAboutUs || null,
        experienceLevel: experienceLevel || null,
        toolsEquipment: toolsEquipment.length > 0 ? toolsEquipment.join(", ") : null,
        emergencyContactName: emergencyContactName || null,
        emergencyContactPhone: emergencyContactPhone || null,
        jobRadius: jobRadius || null,
        extraComments: extraComments || null,
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
        const { data: invites } = await supabase.rpc("get_pending_invite_for_email", { _email: email });
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

  const totalSteps = 3;
  const stepLabels = ["Account", "About you", "Optional"];
  const inputCls = "rounded-ds-md bg-white/60 dark:bg-white/5 border-white/70 dark:border-white/15";
  const labelCls = "text-ds-13 font-sans font-medium";

  const stepHeading =
    step === 1
      ? { title: "Welcome to the neighborhood.", subtitle: "A few minutes now — then everything's set." }
      : step === 2
      ? { title: "Tell us about you.", subtitle: "A photo and a few basics help neighbors trust who they're hiring." }
      : { title: "Make your profile stand out.", subtitle: "Optional — skip anything that doesn't apply." };

  return (
    <AuthShell compactHeader maxWidth="2xl">
      <div className="text-center mb-4 space-y-1.5">
        <span className="text-display-eyebrow">Step {step} of {totalSteps}</span>
        <h1 className="text-page-title leading-tight mt-1">
          {stepHeading.title}
        </h1>
        <p
          className="font-serif italic"
          style={{
            fontSize: "0.95rem",
            color: "hsl(var(--olivewood) / 0.7)",
          }}
        >
          {stepHeading.subtitle}
        </p>
      </div>
      <div className="pb-12">
          <div className="liquid-glass px-6 sm:px-8 py-6 sm:py-7 space-y-6">
            {/* Step progress */}
            <div className="space-y-3">
              <div className="flex items-center justify-between gap-2">
                {stepLabels.map((label, i) => {
                  const stepNum = i + 1;
                  const isDone = stepNum < step;
                  const isActive = stepNum === step;
                  return (
                    <div key={label} className="flex-1 flex flex-col items-center gap-1.5">
                      <div className={`w-7 h-7 rounded-full flex items-center justify-center text-ds-11 font-semibold transition-colors ${
                        isDone ? "bg-primary text-primary-foreground" :
                        isActive ? "bg-primary/15 text-primary border-2 border-primary" :
                        "bg-muted text-muted-foreground"
                      }`}>
                        {isDone ? <BadgeCheck className="w-3.5 h-3.5" /> : stepNum}
                      </div>
                      <span className={`text-ds-10 font-medium text-center ${isActive ? "text-foreground" : "text-muted-foreground"}`}>
                        {label}
                      </span>
                    </div>
                  );
                })}
              </div>
              <div className="h-1 w-full rounded-full bg-muted overflow-hidden">
                <div
                  className="h-full bg-primary transition-all duration-300"
                  style={{ width: `${(step / totalSteps) * 100}%` }}
                />
              </div>
            </div>

            {/* Dev-only step jumper — visible in dev builds so you can click through every signup screen without making an account. Hidden in production. */}
            {import.meta.env.DEV && (
              <div className="rounded-ds-sm border border-dashed border-primary/40 bg-primary/5 p-2 flex items-center gap-2 text-ds-11">
                <span className="text-primary font-semibold uppercase tracking-wider">Preview</span>
                <span className="text-muted-foreground">Jump to step:</span>
                {[1, 2, 3].map((n) => (
                  <button
                    key={n}
                    type="button"
                    onClick={() => setStep(n)}
                    className={`w-6 h-6 rounded-md text-ds-11 font-semibold transition-colors ${
                      step === n
                        ? "bg-primary text-primary-foreground"
                        : "bg-muted hover:bg-muted/80 text-foreground"
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
            idFile={idFile}
            idPreview={idPreview}
            setIdFile={setIdFile}
            setIdPreview={setIdPreview}
            onIdChange={handleIdChange}
            inputCls={inputCls}
            labelCls={labelCls}
            fieldErrors={step2Errors}
            clearFieldError={(key) => setStep2Errors((prev) => { const next = { ...prev }; delete next[key]; return next; })}
            onBack={() => { setStep2Errors({}); setStep(1); }}
            onContinue={async () => {
              if (!(await validateAboutYouStep())) return;
              setStep2Errors({});
              track(AhaEvent.SignupStepCompleted, { step: 2, ...ppoTrackingProps() });
              setStep(3);
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
            confirmPassword={confirmPassword}
            setConfirmPassword={setConfirmPassword}
            showPassword={showPassword}
            setShowPassword={setShowPassword}
            showConfirmPassword={showConfirmPassword}
            setShowConfirmPassword={setShowConfirmPassword}
            acceptedPolicies={acceptedPolicies}
            setAcceptedPolicies={setAcceptedPolicies}
            inputCls={inputCls}
            labelCls={labelCls}
            onContinue={async () => {
              if (!(await validateAccountStep())) return;
              track(AhaEvent.SignupStepCompleted, { step: 1, ...ppoTrackingProps() });
              setStep(2);
            }}
          />
        )}


        {/* Step 3: Optional helpr-quality details (everyone can skip) */}
        {step === 3 && (
          <SignupStep3
            loading={loading}
            skills={skills}
            setSkills={setSkills}
            skillSearch={skillSearch}
            setSkillSearch={setSkillSearch}
            experienceLevel={experienceLevel}
            setExperienceLevel={setExperienceLevel}
            availability={availability}
            setAvailability={setAvailability}
            jobRadius={jobRadius}
            setJobRadius={setJobRadius}
            toolsEquipment={toolsEquipment}
            setToolsEquipment={setToolsEquipment}
            emergencyContactName={emergencyContactName}
            setEmergencyContactName={setEmergencyContactName}
            emergencyContactPhone={emergencyContactPhone}
            setEmergencyContactPhone={setEmergencyContactPhone}
            extraComments={extraComments}
            setExtraComments={setExtraComments}
            hearAboutUs={hearAboutUs}
            setHearAboutUs={setHearAboutUs}
            isLicensed={isLicensed}
            setIsLicensed={setIsLicensed}
            licenseFile={licenseFile}
            setLicenseFile={setLicenseFile}
            licensePreview={licensePreview}
            setLicensePreview={setLicensePreview}
            onLicenseChange={handleLicenseChange}
            isInsured={isInsured}
            setIsInsured={setIsInsured}
            insuranceFile={insuranceFile}
            setInsuranceFile={setInsuranceFile}
            insurancePreview={insurancePreview}
            setInsurancePreview={setInsurancePreview}
            onInsuranceChange={handleInsuranceChange}
            portfolioFiles={portfolioFiles}
            portfolioPreviews={portfolioPreviews}
            onPortfolioSelect={handlePortfolioSelect}
            onPortfolioRemove={removePortfolioFile}
            referralCode={referralCode}
            setReferralCode={setReferralCode}
            inputCls={inputCls}
            labelCls={labelCls}
            onBack={() => setStep(2)}
            onSkip={createAccountAndFinish}
            onSubmit={createAccountAndFinish}
          />
        )}
          </div>

          <p className="text-center text-ds-11 font-sans mt-6" style={{ color: "hsl(var(--olivewood) / 0.7)" }}>
            Already have an account?{" "}
            <Link to="/login" className="font-semibold hover:underline" style={{ color: "hsl(var(--bark))" }}>Sign in</Link>
          </p>
      </div>
    </AuthShell>
  );
};

export default Signup;
