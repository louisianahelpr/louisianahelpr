import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Camera, ArrowRight, ArrowLeft, FileText, X, ImagePlus, Gift, Loader2, Eye, EyeOff, ShieldCheck, UserRound, BadgeCheck, Lock, Award, Shield } from "lucide-react";
import { Checkbox } from "@/components/ui/checkbox";
import { Switch } from "@/components/ui/switch";
import { useSearchParams } from "react-router-dom";
import { usePageTitle } from "@/hooks/usePageTitle";
import { checkPasswordPwned } from "@/lib/hibpCheck";
import { GoogleSignInButton } from "@/components/auth/GoogleSignInButton";
import { AppleSignInButton } from "@/components/auth/AppleSignInButton";
import { track, AhaEvent } from "@/lib/analytics";
import { useEffect } from "react";
import { safeStorage } from "@/lib/safeStorage";
import AuthShell from "@/components/auth/AuthShell";
import { DateOfBirthPicker } from "@/components/DateOfBirthPicker";

const SIGNUP_COOLDOWN_MS = 60_000; // 1 minute between attempts
const SIGNUP_COOLDOWN_KEY = "helpr_signup_last";

const Signup = () => {
  const navigate = useNavigate();
  usePageTitle("Sign Up — Helpr");
  // Funnel event: user landed on signup page (top of activation funnel)
  useEffect(() => {
    track(AhaEvent.SignupStarted, { source: "web" });
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
  const [email, setEmail] = useState("");
  const [confirmEmail, setConfirmEmail] = useState("");
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

  const ALLOWED_IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp", "image/gif"];
  const ALLOWED_DOC_TYPES = [...ALLOWED_IMAGE_TYPES, "application/pdf"];
  const MAX_FILE_SIZE = 5 * 1024 * 1024; // 5MB

  const validateFile = (file: File, allowedTypes: string[], label: string): boolean => {
    if (!allowedTypes.includes(file.type)) {
      toast.error(`${label}: Invalid file type. Allowed: ${allowedTypes.map(t => t.split("/")[1]).join(", ")}`);
      return false;
    }
    if (file.size > MAX_FILE_SIZE) {
      toast.error(`${label}: File too large. Maximum 5MB.`);
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

  const formatPhone = (raw: string) => {
    const digits = raw.replace(/\D/g, "").slice(0, 10);
    if (digits.length === 0) return "";
    if (digits.length < 4) return `(${digits}`;
    if (digits.length < 7) return `(${digits.slice(0, 3)}) ${digits.slice(3)}`;
    return `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`;
  };

  // Step 1 = About you + ID
  const validateStep1 = async () => {
    if (isBusinessSignup && !companyName.trim()) { toast.error("Company name is required"); return false; }
    if (!avatarFile) { toast.error("Profile picture is required"); return false; }
    if (!firstName.trim()) { toast.error("First name is required"); return false; }
    if (!lastName.trim()) { toast.error("Last name is required"); return false; }
    if (!phone.trim()) { toast.error("Phone number is required"); return false; }
    if (!dateOfBirth) { toast.error("Date of birth is required"); return false; }
    const dob = new Date(dateOfBirth);
    const today = new Date();
    let age = today.getFullYear() - dob.getFullYear();
    const monthDiff = today.getMonth() - dob.getMonth();
    if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < dob.getDate())) age--;
    if (age < 18) { toast.error("You must be at least 18 years old to sign up"); return false; }
    if (!location.trim()) { toast.error("City is required"); return false; }
    if (!bio.trim() || bio.trim().length < 20) { toast.error("About you must be at least 20 characters"); return false; }
    if (!idFile) { toast.error("Please upload a government-issued ID to continue"); return false; }

    const normalizedPhone = phone.replace(/\D/g, "").slice(-10);
    if (normalizedPhone.length === 10) {
      const { data: existing } = await supabase
        .from("profiles")
        .select("id")
        .ilike("phone", `%${normalizedPhone.slice(-7)}%`)
        .limit(1);
      if (existing && existing.length > 0) {
        toast.error("This phone number is already associated with an account. Please log in instead.");
        return false;
      }
    }

    return true;
  };

  // Step 2 = Account credentials + agreements
  const validateStep2 = async () => {
    if (!email.trim()) { toast.error("Email is required"); return false; }
    if (email !== confirmEmail) { toast.error("Emails do not match"); return false; }
    if (password.length < 8) { toast.error("Password must be at least 8 characters"); return false; }
    if (!/[A-Z]/.test(password)) { toast.error("Password must contain at least one uppercase letter"); return false; }
    if (!/[0-9]/.test(password)) { toast.error("Password must contain at least one number"); return false; }
    if (password !== confirmPassword) { toast.error("Passwords do not match"); return false; }
    if (!acceptedPolicies) { toast.error("You must agree to the platform rules, terms, and privacy policy"); return false; }
    return true;
  };


  const fileToBase64 = (file: File): Promise<string> => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve((reader.result as string).split(",")[1]);
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
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
    setLoading(true);

    // Rate limiting
    const lastAttempt = parseInt(safeStorage.getItem(SIGNUP_COOLDOWN_KEY) || "0", 10);
    const elapsed = Date.now() - lastAttempt;
    if (elapsed < SIGNUP_COOLDOWN_MS) {
      const secsLeft = Math.ceil((SIGNUP_COOLDOWN_MS - elapsed) / 1000);
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
        toast.success("If this email isn't registered, you'll receive a verification link shortly.");
        navigate("/signup-pending");
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
        } catch { /* silent */ }
      }

      // Business signup: create business
      if (isBusinessSignup && companyName.trim()) {
        try {
          await supabase.from("businesses").insert({
            owner_id: userId,
            name: companyName.trim(),
          });
        } catch (e) { console.error("Business creation failed", e); }
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
      } catch (e) { console.error("Invite linking failed", e); }

      track(AhaEvent.SignupCompleted, { has_referral: !!referralCode.trim() });
      toast.success("Account created! Check your email to verify, then connect your payout account.");
      navigate("/signup-pending");
    } catch (err: any) {
      toast.error(err.message || "Signup failed");
    } finally {
      setLoading(false);
    }
  };

  const totalSteps = 3;
  const stepLabels = ["Account", "About you", "Optional"];
  const inputCls = "rounded-xl bg-white/60 border-white/70";
  const labelCls = "text-sm font-sans font-medium";

  return (
    <AuthShell eyebrow="Join your Louisiana neighbors" maxWidth="2xl">
      <div className="text-center mb-5 space-y-2">
        <span className="text-display-eyebrow">Create account</span>
        <h1
          className="font-display italic font-bold leading-tight mt-2"
          style={{
            fontSize: "clamp(1.85rem, 3vw + 0.5rem, 2.5rem)",
            color: "hsl(var(--ink-deep))",
            letterSpacing: "-0.03em",
          }}
        >
          Welcome to the neighborhood.
        </h1>
        <p
          className="font-serif italic"
          style={{
            fontSize: "1rem",
            color: "hsl(var(--olivewood) / 0.7)",
          }}
        >
          A few minutes now — then everything's set.
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
                      <div className={`w-7 h-7 rounded-full flex items-center justify-center text-[11px] font-semibold transition-colors ${
                        isDone ? "bg-primary text-primary-foreground" :
                        isActive ? "bg-primary/15 text-primary border-2 border-primary" :
                        "bg-muted text-muted-foreground"
                      }`}>
                        {isDone ? <BadgeCheck className="w-3.5 h-3.5" /> : stepNum}
                      </div>
                      <span className={`text-[10px] font-medium text-center ${isActive ? "text-foreground" : "text-muted-foreground"}`}>
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

            {/* Dev-only step jumper — visible on preview/localhost so you can click through every signup screen without making an account. Hidden in production. */}
            {(typeof window !== "undefined" &&
              (window.location.hostname === "localhost" ||
                window.location.hostname.endsWith(".lovable.app") ||
                window.location.hostname.endsWith(".lovableproject.com"))) && (
              <div className="rounded-lg border border-dashed border-primary/40 bg-primary/5 p-2 flex items-center gap-2 text-xs">
                <span className="text-primary font-semibold uppercase tracking-wider">Preview</span>
                <span className="text-muted-foreground">Jump to step:</span>
                {[1, 2, 3].map((n) => (
                  <button
                    key={n}
                    type="button"
                    onClick={() => setStep(n)}
                    className={`w-6 h-6 rounded-md text-[11px] font-semibold transition-colors ${
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

            <div>
              <span className="text-display-eyebrow">Step {step} of {totalSteps}</span>
              <h1
                className="font-display italic font-bold leading-tight mt-1"
                style={{
                  fontSize: "clamp(1.5rem, 2.5vw + 0.5rem, 2rem)",
                  color: "hsl(var(--ink-deep))",
                  letterSpacing: "-0.025em",
                }}
              >
                {step === 1 ? "Create your account." : step === 2 ? "Tell us about you." : "Make your profile stand out."}
              </h1>
            </div>

        {/* Step 2: About you + ID — organized top-down: Profile → Personal → ID */}
        {step === 2 && (
          <div className="space-y-6">

            {isBusinessSignup && (
              <div className="rounded-xl border border-primary/30 bg-primary/5 p-4 space-y-3">
                <p className="text-sm font-semibold text-primary">📊 Business account</p>
                <div className="space-y-2">
                  <Label htmlFor="companyName" className={labelCls}>Company name <span className="text-destructive">*</span></Label>
                  <Input
                    id="companyName"
                    placeholder="Acme Property Management"
                    value={companyName}
                    onChange={(e) => setCompanyName(e.target.value)}
                    required
                    className={inputCls}
                  />
                </div>
                <p className="text-xs text-muted-foreground">
                  You'll be the owner. Invite 1 teammate free (2 seats total) — add more anytime with seat upgrades.
                </p>
              </div>
            )}

            {/* ── Section 1: Your photo (top of page — most personal first) ── */}
            <section className="space-y-4">
              <div className="flex flex-col items-center gap-2">
                <Label className="text-sm font-medium">Profile picture <span className="text-destructive text-xs">*</span></Label>
                <label className="cursor-pointer group relative inline-block">
                  <div className="relative w-28 h-28 rounded-full border-2 border-dashed border-border group-hover:border-primary transition-colors flex items-center justify-center overflow-hidden bg-secondary/40">
                    {avatarPreview ? (
                      <img src={avatarPreview} alt="Avatar" className="w-full h-full object-cover" />
                    ) : (
                      <UserRound className="w-10 h-10 text-muted-foreground" strokeWidth={1.5} />
                    )}
                  </div>
                  <div className="pointer-events-none absolute bottom-0 right-0 w-9 h-9 rounded-full bg-primary text-primary-foreground flex items-center justify-center shadow-lg ring-2 ring-card z-10">
                    <Camera className="w-5 h-5" strokeWidth={2.25} />
                  </div>
                  <input type="file" accept="image/*" className="hidden" onChange={handleAvatarChange} />
                </label>
                <p className="text-[11px] text-muted-foreground text-center max-w-[260px]">
                  A clear face photo builds trust with neighbors. JPG or PNG, max 5MB.
                </p>
              </div>
            </section>

            {/* ── Section 2: Your name + personal details ── */}
            <section className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-2">
                  <Label htmlFor="firstName" className={labelCls}>First name <span className="text-destructive">*</span></Label>
                  <Input id="firstName" placeholder="Jane" value={firstName} onChange={(e) => setFirstName(e.target.value)} required autoComplete="given-name" className={inputCls} />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="lastName" className={labelCls}>Last name <span className="text-destructive">*</span></Label>
                  <Input id="lastName" placeholder="Doe" value={lastName} onChange={(e) => setLastName(e.target.value)} required autoComplete="family-name" className={inputCls} />
                </div>
              </div>
              <div className="space-y-2">
                <Label htmlFor="phone" className={labelCls}>Phone number <span className="text-destructive text-xs">*</span></Label>
                <Input
                  id="phone"
                  type="tel"
                  inputMode="tel"
                  placeholder="(555) 123-4567"
                  value={phone}
                  onChange={(e) => setPhone(formatPhone(e.target.value))}
                  required
                  autoComplete="tel"
                  maxLength={14}
                  className={inputCls}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="dob" className={labelCls}>Date of birth <span className="text-destructive text-xs">*</span></Label>
                <DateOfBirthPicker id="dob" value={dateOfBirth} onChange={setDateOfBirth} />
                <p className="text-xs" style={{ color: "hsl(var(--olivewood) / 0.6)" }}>You must be at least 18 years old.</p>
              </div>
              <div className="space-y-2">
                <Label htmlFor="location" className={labelCls}>City <span className="text-destructive">*</span></Label>
                <Input id="location" placeholder="e.g. Baton Rouge, LA" value={location} onChange={(e) => setLocation(e.target.value)} required autoComplete="address-level2" className={inputCls} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="bio" className={labelCls}>Short bio <span className="text-destructive">*</span></Label>
                <Textarea
                  id="bio"
                  placeholder="Tell us a bit about yourself — whether you're looking for work or need help around the house…"
                  value={bio}
                  onChange={(e) => setBio(e.target.value)}
                  rows={4}
                  required
                  minLength={20}
                  className="rounded-xl"
                />
                <p className={`text-xs ${bio.trim().length >= 20 ? "text-primary" : "text-muted-foreground"}`}>
                  {bio.trim().length}/20 characters minimum {bio.trim().length >= 20 && "✓"}
                </p>
              </div>
            </section>



            {/* ── Section 5: Identity verification ── */}
            <section className="space-y-3">
              <div className="rounded-2xl border border-primary/20 bg-gradient-to-br from-primary/5 to-card p-5 space-y-4">
                <div className="text-center space-y-2">
                  <div className="w-14 h-14 rounded-2xl bg-primary/10 flex items-center justify-center mx-auto">
                    <ShieldCheck className="w-7 h-7 text-primary" strokeWidth={1.75} />
                  </div>
                  <h3 className="text-base font-display font-semibold text-foreground">Government-issued ID <span className="text-destructive">*</span></h3>
                  <p className="text-xs text-muted-foreground leading-relaxed">
                    Driver's license, state ID, or passport. Stored encrypted and used for safety, fraud prevention, and compliance. Re-verified by Stripe when you post or apply to your first job.
                  </p>
                  <div className="flex items-center justify-center gap-1.5 text-[11px] text-primary font-medium pt-1">
                    <Lock className="w-3 h-3" /> Encrypted at rest · Never shared publicly
                  </div>
                </div>
                {idFile ? (
                  <div className="flex items-center justify-between gap-3 rounded-xl liquid-glass p-3">
                    <div className="flex items-center gap-3 min-w-0">
                      {idPreview ? (
                        <img src={idPreview} alt="ID preview" className="w-14 h-14 rounded-lg object-cover border border-border shrink-0" />
                      ) : (
                        <div className="w-14 h-14 rounded-lg border border-border flex items-center justify-center bg-muted/40 shrink-0">
                          <FileText className="w-6 h-6 text-muted-foreground" />
                        </div>
                      )}
                      <div className="min-w-0">
                        <p className="text-sm font-medium text-foreground truncate">{idFile.name}</p>
                        <p className="text-xs text-muted-foreground">{(idFile.size / 1024).toFixed(0)} KB · uploaded</p>
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => { setIdFile(null); setIdPreview(null); }}
                      className="text-xs text-destructive hover:underline shrink-0 font-medium"
                    >
                      Remove
                    </button>
                  </div>
                ) : (
                  <label className="flex flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed border-border bg-card hover:border-primary/60 hover:bg-primary/[0.02] px-4 py-7 cursor-pointer transition-all">
                    <Camera className="w-7 h-7 text-primary/70" strokeWidth={1.75} />
                    <span className="text-sm font-semibold text-foreground">Upload your ID</span>
                    <span className="text-xs text-muted-foreground">JPG, PNG, or PDF · Max 5MB</span>
                    <input
                      type="file"
                      accept="image/jpeg,image/png,image/webp,application/pdf"
                      className="hidden"
                      onChange={handleIdChange}
                    />
                  </label>
                )}
              </div>
            </section>

            <div className="flex gap-3">
              <Button variant="outline" className="flex-1" onClick={() => setStep(1)}>
                <ArrowLeft className="w-4 h-4 mr-1" /> Back
              </Button>
              <Button
                className="flex-1"
                size="lg"
                onClick={async () => {
                  if (!(await validateStep1())) return;
                  setStep(3);
                }}
              >
                Continue <ArrowRight className="w-4 h-4 ml-1" />
              </Button>
            </div>
          </div>
        )}

        {/* Step 1: Account credentials + agreements */}
        {step === 1 && (
          <div className="space-y-6">
            <section className="space-y-3">
              <div className="space-y-2">
                <Label htmlFor="email" className={labelCls}>Email <span className="text-destructive">*</span></Label>
                <Input id="email" type="email" placeholder="you@example.com" value={email} onChange={(e) => setEmail(e.target.value)} required autoComplete="email" className={inputCls} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="confirmEmail" className={labelCls}>Confirm email <span className="text-destructive">*</span></Label>
                <Input id="confirmEmail" type="email" placeholder="Re-enter your email" value={confirmEmail} onChange={(e) => setConfirmEmail(e.target.value)} required autoComplete="email" className={inputCls} />
                {confirmEmail && (
                  <p className={`text-xs ${email === confirmEmail ? "text-primary" : "text-destructive"}`}>
                    {email === confirmEmail ? "✓ Emails match" : "✗ Emails do not match"}
                  </p>
                )}
              </div>
              <div className="space-y-2">
                <Label htmlFor="password" className={labelCls}>Password <span className="text-destructive">*</span></Label>
                <div className="relative">
                  <Input id="password" type={showPassword ? "text" : "password"} placeholder="At least 8 characters, 1 uppercase, 1 number" value={password} onChange={(e) => setPassword(e.target.value)} required minLength={8} className={`${inputCls} pr-10`} autoComplete="new-password" />
                  <button type="button" onClick={() => setShowPassword(!showPassword)} className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors">
                    {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
              </div>
              <div className="space-y-2">
                <Label htmlFor="confirmPassword" className={labelCls}>Confirm password <span className="text-destructive">*</span></Label>
                <div className="relative">
                  <Input id="confirmPassword" type={showConfirmPassword ? "text" : "password"} placeholder="Re-enter your password" value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)} required minLength={8} className={`${inputCls} pr-10`} autoComplete="new-password" />
                  <button type="button" onClick={() => setShowConfirmPassword(!showConfirmPassword)} className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors">
                    {showConfirmPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
                {confirmPassword && (
                  <p className={`text-xs ${password === confirmPassword ? "text-primary" : "text-destructive"}`}>
                    {password === confirmPassword ? "✓ Passwords match" : "✗ Passwords do not match"}
                  </p>
                )}
              </div>
            </section>

            <div className="flex items-start gap-2.5 px-1">
              <Checkbox
                id="policies"
                checked={acceptedPolicies}
                onCheckedChange={(checked) => setAcceptedPolicies(checked === true)}
                className="h-3.5 w-3.5 mt-[3px] [&_svg]:h-3 [&_svg]:w-3"
              />
              <label
                htmlFor="policies"
                className="text-xs leading-relaxed cursor-pointer font-sans"
                style={{ color: "hsl(var(--olivewood) / 0.75)" }}
              >
                I agree to the{" "}
                <Link to="/rules" target="_blank" className="font-semibold hover:underline" style={{ color: "hsl(var(--bark))" }}>Platform Rules</Link>,{" "}
                <Link to="/terms" target="_blank" className="font-semibold hover:underline" style={{ color: "hsl(var(--bark))" }}>Terms of Service</Link>, and{" "}
                <Link to="/privacy" target="_blank" className="font-semibold hover:underline" style={{ color: "hsl(var(--bark))" }}>Privacy Policy</Link>.
                I understand the cancellation, no-show, and dispute policies.
              </label>
            </div>

            <Button
              className="w-full"
              size="lg"
              onClick={async () => {
                if (!(await validateStep2())) return;
                setStep(2);
              }}
              disabled={!acceptedPolicies}
            >
              Continue <ArrowRight className="w-4 h-4 ml-1" />
            </Button>

            <div className="relative">
              <div className="absolute inset-0 flex items-center">
                <span className="w-full border-t border-border/60" />
              </div>
              <div className="relative flex justify-center text-xs uppercase">
                <span className="bg-card px-2 text-muted-foreground">or</span>
              </div>
            </div>

            <div className="space-y-2">
              <GoogleSignInButton label="Sign up with Google" />
              <AppleSignInButton label="Sign up with Apple" />
            </div>
          </div>
        )}


        {/* Step 3: Optional helpr-quality details (everyone can skip) */}
        {step === 3 && (
          <div className="space-y-4">
            {/* Path B: Helprs — strongly emphasized, now FIRST */}
            <div className="rounded-2xl border-2 border-primary bg-gradient-to-br from-primary/10 to-primary/5 p-4 space-y-2 shadow-sm">
              <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-2.5 min-w-0">
                  <ShieldCheck className="w-5 h-5 text-primary shrink-0" />
                  <p className="text-base font-bold text-foreground leading-tight">
                    Applying for jobs?
                  </p>
                </div>
                <span className="text-[10px] font-bold uppercase tracking-wide px-2 py-1 rounded-full bg-primary text-primary-foreground shrink-0">
                  Recommended
                </span>
              </div>
              <p className="text-sm text-foreground/80 leading-relaxed">
                Complete profiles get <span className="font-semibold">3× more offers</span>. Takes 2 minutes.
              </p>
            </div>

            {/* Path A: Posters — compact skip card */}
            <div className="rounded-xl border border-border bg-muted/30 px-3 py-2.5 flex items-center justify-between gap-3">
              <p className="text-xs text-muted-foreground leading-snug min-w-0">
                Just posting jobs? Nothing below is required.
              </p>
              <Button
                variant="outline"
                size="sm"
                className="h-8 px-3 text-xs shrink-0"
                disabled={loading}
                onClick={createAccountAndFinish}
              >
                {loading
                  ? <><Loader2 className="w-3.5 h-3.5 mr-1 animate-spin" /> Creating…</>
                  : <>Skip <ArrowRight className="w-3.5 h-3.5 ml-1" /></>}
              </Button>
            </div>

            {/* Skills — most important for job matching */}
            <div className="space-y-2">
              <Label htmlFor="skill-search" className={labelCls}>
                Skills <span className="text-muted-foreground text-xs">(optional)</span>
              </Label>
              <Input
                id="skill-search"
                placeholder="Search skills…"
                value={skillSearch}
                onChange={(e) => setSkillSearch(e.target.value)}
                className={inputCls}
              />
              {(() => {
                const ALL_SKILLS = [
                  "Cleaning", "Moving", "Handyman", "Yard Work", "Painting", "Delivery", "Pet Care", "Errands", "Assembly",
                  "Pressure Washing", "Lawn Care", "Plumbing", "Electrical", "Carpentry", "Tile Work", "Drywall",
                  "Babysitting", "Senior Care", "Tutoring", "Cooking", "Laundry", "Organizing", "Event Help",
                  "Photography", "Web Design", "Tech Support", "Junk Removal", "Auto Detailing", "Gutter Cleaning",
                ];
                const selectedSkills = skills.split(",").map(s => s.trim()).filter(Boolean);
                const filtered = ALL_SKILLS.filter(s => s.toLowerCase().includes(skillSearch.toLowerCase()));
                const toggleSkill = (skill: string) => {
                  const isActive = selectedSkills.some(s => s.toLowerCase() === skill.toLowerCase());
                  if (isActive) {
                    setSkills(selectedSkills.filter(s => s.toLowerCase() !== skill.toLowerCase()).join(", "));
                  } else {
                    setSkills([...selectedSkills, skill].join(", "));
                  }
                };
                return (
                  <>
                    {selectedSkills.length > 0 && (
                      <div className="flex flex-wrap gap-1.5 pt-1">
                        {selectedSkills.map((s) => (
                          <button
                            key={s}
                            type="button"
                            onClick={() => toggleSkill(s)}
                            className="px-2.5 py-1 rounded-full text-xs font-medium border bg-primary text-primary-foreground border-primary inline-flex items-center gap-1"
                          >
                            {s} <X className="w-3 h-3" />
                          </button>
                        ))}
                      </div>
                    )}
                    <div className="max-h-32 overflow-y-auto rounded-xl border border-border bg-muted/20 p-2">
                      <div className="flex flex-wrap gap-1.5">
                        {filtered.length === 0 ? (
                          <p className="text-xs text-muted-foreground px-1 py-1">No matches. Type your own below.</p>
                        ) : (
                          filtered.map((skill) => {
                            const isActive = selectedSkills.some(s => s.toLowerCase() === skill.toLowerCase());
                            return (
                              <button
                                key={skill}
                                type="button"
                                onClick={() => toggleSkill(skill)}
                                className={`px-2.5 py-1 rounded-full text-xs font-medium border transition-colors ${
                                  isActive
                                    ? "bg-primary text-primary-foreground border-primary"
                                    : "bg-background text-foreground border-border hover:border-primary/50"
                                }`}
                              >
                                {isActive ? "✓ " : "+ "}{skill}
                              </button>
                            );
                          })
                        )}
                      </div>
                    </div>
                    {skillSearch.trim() && !ALL_SKILLS.some(s => s.toLowerCase() === skillSearch.trim().toLowerCase()) && (
                      <button
                        type="button"
                        onClick={() => { toggleSkill(skillSearch.trim()); setSkillSearch(""); }}
                        className="text-xs text-primary font-medium hover:underline"
                      >
                        + Add "{skillSearch.trim()}" as a custom skill
                      </button>
                    )}
                  </>
                );
              })()}
            </div>

            {/* Experience level */}
            <div className="space-y-2">
              <Label>Experience level <span className="text-muted-foreground text-xs">(optional)</span></Label>
              <div className="flex flex-wrap gap-1.5">
                {["Beginner", "Some experience", "Experienced", "Professional"].map((opt) => {
                  const isActive = experienceLevel === opt;
                  return (
                    <button
                      key={opt}
                      type="button"
                      onClick={() => setExperienceLevel(isActive ? "" : opt)}
                      className={`px-2.5 py-1 rounded-full text-xs font-medium border transition-colors ${
                        isActive
                          ? "bg-primary text-primary-foreground border-primary"
                          : "bg-secondary/50 text-muted-foreground border-border hover:border-primary/50"
                      }`}
                    >
                      {isActive ? "✓ " : ""}{opt}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Availability */}
            <div className="space-y-2">
              <Label>Availability <span className="text-muted-foreground text-xs">(optional)</span></Label>
              <div className="flex flex-wrap gap-1.5">
                {["Weekday mornings", "Weekday afternoons", "Weekday evenings", "Weekends", "Flexible / Anytime"].map((slot) => {
                  const isActive = availability.includes(slot);
                  return (
                    <button
                      key={slot}
                      type="button"
                      onClick={() => {
                        setAvailability(isActive ? availability.filter(a => a !== slot) : [...availability, slot]);
                      }}
                      className={`px-2.5 py-1 rounded-full text-xs font-medium border transition-colors ${
                        isActive
                          ? "bg-primary text-primary-foreground border-primary"
                          : "bg-secondary/50 text-muted-foreground border-border hover:border-primary/50"
                      }`}
                    >
                      {isActive ? "✓ " : "+ "}{slot}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Preferred job radius */}
            <div className="space-y-2">
              <Label>Preferred job radius <span className="text-muted-foreground text-xs">(optional)</span></Label>
              <div className="flex flex-wrap gap-1.5">
                {["5 miles", "10 miles", "25 miles", "50+ miles", "Anywhere"].map((opt) => {
                  const isActive = jobRadius === opt;
                  return (
                    <button
                      key={opt}
                      type="button"
                      onClick={() => setJobRadius(isActive ? "" : opt)}
                      className={`px-2.5 py-1 rounded-full text-xs font-medium border transition-colors ${
                        isActive
                          ? "bg-primary text-primary-foreground border-primary"
                          : "bg-secondary/50 text-muted-foreground border-border hover:border-primary/50"
                      }`}
                    >
                      {isActive ? "✓ " : ""}{opt}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Tools / Equipment */}
            <div className="space-y-2">
              <Label>Tools / Equipment you have <span className="text-muted-foreground text-xs">(optional)</span></Label>
              <Input
                placeholder="e.g. Lawn mower, power tools, pressure washer"
                value={toolsEquipment.join(", ")}
                onChange={(e) => setToolsEquipment(e.target.value ? e.target.value.split(",").map(s => s.trimStart()) : [])}
              />
              <div className="flex flex-wrap gap-1.5">
                {["Basic hand tools", "Power tools", "Lawn mower", "Pressure washer", "Ladder", "Cleaning supplies", "Moving dolly / straps", "Paint supplies"].map((tool) => {
                  const isActive = toolsEquipment.includes(tool);
                  return (
                    <button
                      key={tool}
                      type="button"
                      onClick={() => setToolsEquipment(isActive ? toolsEquipment.filter(t => t !== tool) : [...toolsEquipment, tool])}
                      className={`px-2.5 py-1 rounded-full text-xs font-medium border transition-colors ${
                        isActive
                          ? "bg-primary text-primary-foreground border-primary"
                          : "bg-secondary/50 text-muted-foreground border-border hover:border-primary/50"
                      }`}
                    >
                      {isActive ? "✓ " : "+ "}{tool}
                    </button>
                  );
                })}
              </div>
              <p className="text-xs text-muted-foreground">Type your own or tap common options above.</p>
            </div>

            {/* Emergency contact */}
            <div className="space-y-3 rounded-lg border border-border bg-muted/30 p-3">
              <p className="text-xs font-medium text-foreground">Emergency Contact <span className="text-muted-foreground">(optional but recommended)</span></p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                <Input placeholder="Contact name" value={emergencyContactName} onChange={(e) => setEmergencyContactName(e.target.value)} autoComplete="name" />
                <Input type="tel" placeholder="Contact phone" value={emergencyContactPhone} onChange={(e) => setEmergencyContactPhone(e.target.value)} autoComplete="tel" />
              </div>
            </div>

            {/* Extra comments */}
            <div className="space-y-2">
              <Label htmlFor="extraComments">Anything else you'd like us to know? <span className="text-muted-foreground text-xs">(optional)</span></Label>
              <Textarea
                id="extraComments"
                placeholder="Special certifications, languages spoken, why you want to join, or anything else…"
                value={extraComments}
                onChange={(e) => setExtraComments(e.target.value)}
                rows={3}
              />
            </div>

            {/* How did you hear about us */}
            <div className="space-y-2">
              <Label htmlFor="hear">How did you hear about us? <span className="text-muted-foreground text-xs">(optional)</span></Label>
              <div className="flex flex-wrap gap-1.5">
                {["Word of mouth", "Social media", "Google search", "Flyer / poster", "Friend / family", "Other"].map((opt) => {
                  const isActive = hearAboutUs === opt;
                  return (
                    <button
                      key={opt}
                      type="button"
                      onClick={() => setHearAboutUs(isActive ? "" : opt)}
                      className={`px-2.5 py-1 rounded-full text-xs font-medium border transition-colors ${
                        isActive
                          ? "bg-primary text-primary-foreground border-primary"
                          : "bg-secondary/50 text-muted-foreground border-border hover:border-primary/50"
                      }`}
                    >
                      {isActive ? "✓ " : ""}{opt}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Professional Credentials — optional, with hard requirement when toggled */}
            <div className="rounded-2xl border border-primary/30 bg-gradient-to-br from-primary/5 to-card p-5 space-y-4">
              <div className="text-center space-y-1">
                <div className="w-12 h-12 rounded-2xl bg-primary/10 flex items-center justify-center mx-auto">
                  <Award className="w-6 h-6 text-primary" strokeWidth={1.75} />
                </div>
                <h3 className="text-base font-display font-semibold text-foreground">Professional credentials</h3>
                <p className="text-xs text-muted-foreground leading-relaxed">
                  Optional — earn a verified badge that helps you get picked first. You can also add these later in Profile → Credentials.
                </p>
              </div>

              {/* Licensed toggle */}
              <div className="rounded-xl liquid-glass p-4 space-y-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="space-y-0.5">
                    <Label htmlFor="is-licensed" className="text-sm font-semibold text-foreground flex items-center gap-1.5">
                      <BadgeCheck className="w-4 h-4 text-primary" /> I am licensed
                    </Label>
                    <p className="text-xs text-muted-foreground">Trade, contractor, or professional license.</p>
                  </div>
                  <Switch
                    id="is-licensed"
                    checked={isLicensed}
                    onCheckedChange={(v) => {
                      setIsLicensed(v);
                      if (!v) { setLicenseFile(null); setLicensePreview(null); }
                    }}
                  />
                </div>
                {isLicensed && (
                  licenseFile ? (
                    <div className="flex items-center justify-between gap-3 rounded-lg border border-border bg-muted/30 p-3">
                      <div className="flex items-center gap-3 min-w-0">
                        {licensePreview ? (
                          <img src={licensePreview} alt="License preview" className="w-12 h-12 rounded-md object-cover border border-border shrink-0" />
                        ) : (
                          <div className="w-12 h-12 rounded-md border border-border flex items-center justify-center bg-muted/40 shrink-0">
                            <FileText className="w-5 h-5 text-muted-foreground" />
                          </div>
                        )}
                        <div className="min-w-0">
                          <p className="text-sm font-medium text-foreground truncate">{licenseFile.name}</p>
                          <p className="text-xs text-muted-foreground">{(licenseFile.size / 1024).toFixed(0)} KB · pending review</p>
                        </div>
                      </div>
                      <button
                        type="button"
                        onClick={() => { setLicenseFile(null); setLicensePreview(null); }}
                        className="text-xs text-destructive hover:underline shrink-0 font-medium"
                      >
                        Remove
                      </button>
                    </div>
                  ) : (
                    <label className="flex flex-col items-center justify-center gap-1.5 rounded-lg border-2 border-dashed border-primary/40 bg-primary/[0.03] hover:border-primary/70 px-4 py-5 cursor-pointer transition-all">
                      <ImagePlus className="w-5 h-5 text-primary" strokeWidth={1.75} />
                      <span className="text-sm font-semibold text-foreground">Upload license <span className="text-destructive">*</span></span>
                      <span className="text-[11px] text-muted-foreground">JPG, PNG, or PDF · Max 5MB · Required to continue</span>
                      <input
                        type="file"
                        accept="image/jpeg,image/png,image/webp,application/pdf"
                        className="hidden"
                        onChange={handleLicenseChange}
                      />
                    </label>
                  )
                )}
              </div>

              {/* Insured toggle */}
              <div className="rounded-xl liquid-glass p-4 space-y-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="space-y-0.5">
                    <Label htmlFor="is-insured" className="text-sm font-semibold text-foreground flex items-center gap-1.5">
                      <Shield className="w-4 h-4 text-primary" /> I am insured
                    </Label>
                    <p className="text-xs text-muted-foreground">General liability or professional insurance.</p>
                  </div>
                  <Switch
                    id="is-insured"
                    checked={isInsured}
                    onCheckedChange={(v) => {
                      setIsInsured(v);
                      if (!v) { setInsuranceFile(null); setInsurancePreview(null); }
                    }}
                  />
                </div>
                {isInsured && (
                  insuranceFile ? (
                    <div className="flex items-center justify-between gap-3 rounded-lg border border-border bg-muted/30 p-3">
                      <div className="flex items-center gap-3 min-w-0">
                        {insurancePreview ? (
                          <img src={insurancePreview} alt="Insurance preview" className="w-12 h-12 rounded-md object-cover border border-border shrink-0" />
                        ) : (
                          <div className="w-12 h-12 rounded-md border border-border flex items-center justify-center bg-muted/40 shrink-0">
                            <FileText className="w-5 h-5 text-muted-foreground" />
                          </div>
                        )}
                        <div className="min-w-0">
                          <p className="text-sm font-medium text-foreground truncate">{insuranceFile.name}</p>
                          <p className="text-xs text-muted-foreground">{(insuranceFile.size / 1024).toFixed(0)} KB · pending review</p>
                        </div>
                      </div>
                      <button
                        type="button"
                        onClick={() => { setInsuranceFile(null); setInsurancePreview(null); }}
                        className="text-xs text-destructive hover:underline shrink-0 font-medium"
                      >
                        Remove
                      </button>
                    </div>
                  ) : (
                    <label className="flex flex-col items-center justify-center gap-1.5 rounded-lg border-2 border-dashed border-primary/40 bg-primary/[0.03] hover:border-primary/70 px-4 py-5 cursor-pointer transition-all">
                      <ImagePlus className="w-5 h-5 text-primary" strokeWidth={1.75} />
                      <span className="text-sm font-semibold text-foreground">Upload insurance <span className="text-destructive">*</span></span>
                      <span className="text-[11px] text-muted-foreground">JPG, PNG, or PDF · Max 5MB · Required to continue</span>
                      <input
                        type="file"
                        accept="image/jpeg,image/png,image/webp,application/pdf"
                        className="hidden"
                        onChange={handleInsuranceChange}
                      />
                    </label>
                  )
                )}
              </div>

              <p className="text-[11px] text-muted-foreground text-center">
                Documents are reviewed by our team. Your verified badge appears once approved.
              </p>
            </div>

            {/* Portfolio — optional */}
            <div className="rounded-xl liquid-glass p-5 space-y-4">
              <div className="text-center space-y-2">
                <FileText className="w-10 h-10 text-primary mx-auto" />
                <h3 className="font-semibold text-foreground">Portfolio (optional)</h3>
                <p className="text-xs text-muted-foreground">
                  A few photos of past work — finished lawns, clean driveways, repairs — help posters trust you instantly.
                </p>
                <p className="text-xs text-primary font-medium mt-1">💎 Portfolio Showcase is a Pro+ subscriber perk — you can upload now, but only Pro/Elite subscribers' portfolios will be visible on their profiles.</p>
              </div>

              <div className="flex flex-wrap gap-3">
                {portfolioPreviews.map((preview, i) => (
                  <div key={i} className="relative group">
                    {preview.type.startsWith("image/") ? (
                      <div className="w-20 h-20 rounded-lg overflow-hidden border border-border">
                        <img src={preview.url} alt="" className="w-full h-full object-cover" />
                      </div>
                    ) : (
                      <div className="w-20 h-20 rounded-lg border border-border flex flex-col items-center justify-center bg-secondary/30 px-1">
                        <FileText className="w-5 h-5 text-muted-foreground" />
                        <p className="text-[9px] text-muted-foreground text-center mt-1 truncate w-full">{preview.name}</p>
                      </div>
                    )}
                    <button
                      type="button"
                      onClick={() => removePortfolioFile(i)}
                      className="absolute -top-1 -right-1 w-5 h-5 rounded-full bg-destructive text-destructive-foreground flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
                    >
                      <X className="w-3 h-3" />
                    </button>
                  </div>
                ))}
                {portfolioFiles.length < 10 && (
                  <label className="w-20 h-20 rounded-lg border-2 border-dashed border-border hover:border-primary/50 flex flex-col items-center justify-center cursor-pointer transition-colors">
                    <ImagePlus className="w-5 h-5 text-muted-foreground" />
                    <span className="text-[10px] text-muted-foreground mt-0.5">Add</span>
                    <input
                      type="file"
                      accept="image/*,.pdf,.doc,.docx"
                      multiple
                      className="hidden"
                      onChange={handlePortfolioSelect}
                    />
                  </label>
                )}
              </div>
              <p className="text-xs text-muted-foreground">
                Up to 10 files · Images, PDFs, or documents
              </p>
            </div>

            {/* Referral code — least important, last */}
            <div className="space-y-2">
              <Label htmlFor="referral" className={`${labelCls} flex items-center gap-1.5`}>
                <Gift className="w-4 h-4 text-primary" /> Referral code <span className="text-muted-foreground text-xs">(optional)</span>
              </Label>
              <Input
                id="referral"
                placeholder="Enter referral code for $5 credit"
                value={referralCode}
                onChange={(e) => setReferralCode(e.target.value.toUpperCase())}
                maxLength={10}
                className={`${inputCls} uppercase`}
              />
              {referralCode && (
                <p className="text-xs text-primary flex items-center gap-1">
                  <Gift className="w-3 h-3" /> You'll earn $5 when you complete your first job — as poster or crew!
                </p>
              )}
            </div>

            <div className="flex gap-3">
              <Button variant="outline" className="flex-1" onClick={() => setStep(2)}>
                <ArrowLeft className="w-4 h-4 mr-1" /> Back
              </Button>
              <Button
                className="flex-1"
                onClick={() => {
                  if (isLicensed && !licenseFile) { toast.error("Please upload your license or turn off the Licensed toggle"); return; }
                  if (isInsured && !insuranceFile) { toast.error("Please upload your insurance document or turn off the Insured toggle"); return; }
                  createAccountAndFinish();
                }}
                disabled={loading || (isLicensed && !licenseFile) || (isInsured && !insuranceFile)}
              >
                {loading
                  ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> Creating account…</>
                  : <>Create account <ArrowRight className="w-4 h-4 ml-1" /></>}
              </Button>
            </div>
          </div>
        )}
          </div>

          <p className="text-center text-xs font-sans mt-6" style={{ color: "hsl(var(--olivewood) / 0.7)" }}>
            Already have an account?{" "}
            <Link to="/login" className="font-semibold hover:underline" style={{ color: "hsl(var(--bark))" }}>Sign in</Link>
          </p>
      </div>
    </AuthShell>
  );
};

export default Signup;
