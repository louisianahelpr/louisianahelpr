import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Camera, ArrowRight, ArrowLeft, FileText, X, ImagePlus, Gift, Loader2, Eye, EyeOff } from "lucide-react";
import { Checkbox } from "@/components/ui/checkbox";
import { useSearchParams } from "react-router-dom";
import { usePageTitle } from "@/hooks/usePageTitle";
import PageHeader from "@/components/PageHeader";

const SIGNUP_COOLDOWN_MS = 60_000; // 1 minute between attempts
const SIGNUP_COOLDOWN_KEY = "helpr_signup_last";

const Signup = () => {
  const navigate = useNavigate();
  usePageTitle("Sign Up — Helpr");
  const [searchParams] = useSearchParams();
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
  const [transportation, setTransportation] = useState("");
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

  // ID upload removed — Stripe Express handles identity via free database matching (SSN/IRS/credit bureau)

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

  const validateStep1 = async () => {
    if (!firstName.trim()) { toast.error("First name is required"); return false; }
    if (!lastName.trim()) { toast.error("Last name is required"); return false; }
    if (!email.trim()) { toast.error("Email is required"); return false; }
    if (email !== confirmEmail) { toast.error("Emails do not match"); return false; }
    if (password.length < 8) { toast.error("Password must be at least 8 characters"); return false; }
    if (!/[A-Z]/.test(password)) { toast.error("Password must contain at least one uppercase letter"); return false; }
    if (!/[0-9]/.test(password)) { toast.error("Password must contain at least one number"); return false; }
    if (password !== confirmPassword) { toast.error("Passwords do not match"); return false; }
    if (!phone.trim()) { toast.error("Phone number is required"); return false; }
    if (!dateOfBirth) { toast.error("Date of birth is required"); return false; }
    const dob = new Date(dateOfBirth);
    const today = new Date();
    let age = today.getFullYear() - dob.getFullYear();
    const monthDiff = today.getMonth() - dob.getMonth();
    if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < dob.getDate())) age--;
    if (age < 18) { toast.error("You must be at least 18 years old to sign up"); return false; }
    if (!acceptedPolicies) { toast.error("You must agree to the platform rules, terms, and privacy policy"); return false; }

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

  const validateStep2 = () => {
    if (!avatarFile) { toast.error("Profile picture is required"); return false; }
    if (!bio.trim() || bio.trim().length < 20) { toast.error("About you must be at least 20 characters"); return false; }
    if (!location.trim()) { toast.error("City is required"); return false; }
    return true;
  };

  const validateStep4 = () => {
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

    const portfolioData = [];
    for (const file of portfolioFiles) {
      portfolioData.push({
        base64: await fileToBase64(file),
        ext: file.name.split(".").pop(),
        contentType: file.type,
      });
    }

    return { avatarBase64, avatarExt, portfolioData };
  };

  const completeProfile = async (userId: string) => {
    const { avatarBase64, avatarExt, portfolioData } = await prepareFileData();

    const { data: result, error: fnError } = await supabase.functions.invoke("complete-signup", {
      body: {
        userId,
        avatarBase64,
        avatarExt,
        avatarContentType: avatarFile?.type,
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
    const lastAttempt = parseInt(localStorage.getItem(SIGNUP_COOLDOWN_KEY) || "0", 10);
    const elapsed = Date.now() - lastAttempt;
    if (elapsed < SIGNUP_COOLDOWN_MS) {
      const secsLeft = Math.ceil((SIGNUP_COOLDOWN_MS - elapsed) / 1000);
      toast.error(`Please wait ${secsLeft} seconds before trying again`);
      setLoading(false);
      return;
    }
    localStorage.setItem(SIGNUP_COOLDOWN_KEY, String(Date.now()));

    try {
      const { data: authData, error: authError } = await supabase.auth.signUp({
        email,
        password,
        options: {
          emailRedirectTo: `${window.location.origin}/account-pending`,
          data: { full_name: fullName, role: "customer" },
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

      toast.success("Account created! Check your email to verify, then connect your payout account.");
      navigate("/signup-pending");
    } catch (err: any) {
      toast.error(err.message || "Signup failed");
    } finally {
      setLoading(false);
    }
  };

  const totalSteps = 3;
  const inputCls = "rounded-xl";
  const labelCls = "text-base font-medium";

  const handleBack = () => {
    if (step > 1) setStep((step - 1) as 1 | 2 | 3);
    else navigate("/");
  };

  return (
    <div className="min-h-screen bg-background">
      <PageHeader title="Create your account" onBack={handleBack} />
      <div className="flex items-start sm:items-center justify-center px-4 py-8 sm:py-12">
        <div className={`w-full max-w-md space-y-6 ${step === 4 ? "pb-32" : "pb-12"} sm:pb-12`}>

        {/* Step 1: Account basics */}
        {step === 1 && (
          <div className="space-y-4">
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
              <Label htmlFor="email" className={labelCls}>Email <span className="text-destructive">*</span></Label>
              <Input id="email" type="email" placeholder="you@example.com" value={email} onChange={(e) => setEmail(e.target.value)} required autoComplete="email" className={inputCls} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="confirmEmail" className={labelCls}>Confirm email <span className="text-destructive">*</span></Label>
              <Input id="confirmEmail" type="email" placeholder="Re-enter your email" value={confirmEmail} onChange={(e) => setConfirmEmail(e.target.value)} required className={inputCls} />
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
            <div className="space-y-2">
              <Label htmlFor="dob" className={labelCls}>Date of birth <span className="text-destructive text-xs">*</span></Label>
              <Input id="dob" type="date" value={dateOfBirth} onChange={(e) => setDateOfBirth(e.target.value)} required max={new Date(new Date().getFullYear() - 18, new Date().getMonth(), new Date().getDate()).toISOString().split("T")[0]} className={inputCls} />
              <p className="text-xs text-muted-foreground">You must be at least 18 years old</p>
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
            <div className="flex items-start gap-3 rounded-lg border border-border bg-muted/30 p-3">
              <Checkbox
                id="policies"
                checked={acceptedPolicies}
                onCheckedChange={(checked) => setAcceptedPolicies(checked === true)}
                className="mt-0.5"
              />
              <label htmlFor="policies" className="text-xs text-muted-foreground leading-relaxed cursor-pointer">
                I agree to the{" "}
                <Link to="/rules" target="_blank" className="text-primary hover:underline font-medium">Platform Rules</Link>,{" "}
                <Link to="/terms" target="_blank" className="text-primary hover:underline font-medium">Terms of Service</Link>, and{" "}
                <Link to="/privacy" target="_blank" className="text-primary hover:underline font-medium">Privacy Policy</Link>.
                I understand the cancellation, no-show, and dispute policies.
              </label>
            </div>
            <Button className="w-full" size="lg" onClick={async () => { if (await validateStep1()) setStep(2); }} disabled={!acceptedPolicies}>
              Continue <ArrowRight className="w-4 h-4 ml-1" />
            </Button>
          </div>
        )}

        {/* Step 2: Profile details */}
        {step === 2 && (
          <div className="space-y-4">
            <div className="rounded-lg border border-primary/30 bg-primary/5 p-3 text-center">
              <p className="text-sm font-medium text-primary">💡 The more you share, the better your chances!</p>
              <p className="text-xs text-muted-foreground mt-1">Completed profiles get up to 3x more job offers. Fill in as much as you can.</p>
            </div>
            <div className="flex flex-col items-center gap-3">
              <Label>Profile picture <span className="text-destructive text-xs">*</span></Label>
              <label className="cursor-pointer group">
                <div className="w-24 h-24 rounded-full border-2 border-dashed border-border group-hover:border-primary transition-colors flex items-center justify-center overflow-hidden bg-secondary">
                  {avatarPreview ? (
                    <img src={avatarPreview} alt="Avatar" className="w-full h-full object-cover" />
                  ) : (
                    <Camera className="w-8 h-8 text-muted-foreground" />
                  )}
                </div>
                <input type="file" accept="image/*" className="hidden" onChange={handleAvatarChange} />
              </label>
            </div>

            <div className="space-y-2">
              <Label htmlFor="bio" className={labelCls}>About you <span className="text-destructive">*</span></Label>
              <Textarea
                id="bio"
                placeholder="Hey! I'm someone who loves helping out around the neighborhood. I've got a knack for…"
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
            <div className="space-y-2">
              <Label htmlFor="location" className={labelCls}>City <span className="text-destructive">*</span></Label>
              <Input id="location" placeholder="e.g. Baton Rouge, LA" value={location} onChange={(e) => setLocation(e.target.value)} required className={inputCls} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="skill-search" className={labelCls}>
                Skills <span className="text-muted-foreground text-xs">(optional — recommended for helprs)</span>
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
              <p className="text-xs text-muted-foreground">Only posting tasks? You can skip this and add skills later.</p>
            </div>

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

            <div className="space-y-2">
              <Label>Do you have reliable transportation? <span className="text-muted-foreground text-xs">(optional)</span></Label>
              <div className="flex gap-2">
                {["Yes", "No"].map((opt) => {
                  const isActive = transportation === opt;
                  return (
                    <button
                      key={opt}
                      type="button"
                      onClick={() => setTransportation(isActive ? "" : opt)}
                      className={`px-4 py-2 rounded-xl text-sm font-medium border transition-colors ${
                        isActive
                          ? "bg-primary text-primary-foreground border-primary"
                          : "bg-secondary/50 text-muted-foreground border-border hover:border-primary/50"
                      }`}
                    >
                      {opt}
                    </button>
                  );
                })}
              </div>
            </div>

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

            <div className="space-y-3 rounded-lg border border-border bg-muted/30 p-3">
              <p className="text-xs font-medium text-foreground">Emergency Contact <span className="text-muted-foreground">(optional but recommended)</span></p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                <Input placeholder="Contact name" value={emergencyContactName} onChange={(e) => setEmergencyContactName(e.target.value)} />
                <Input type="tel" placeholder="Contact phone" value={emergencyContactPhone} onChange={(e) => setEmergencyContactPhone(e.target.value)} />
              </div>
            </div>

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
            <div className="flex gap-3">
              <Button variant="outline" className="flex-1" onClick={() => setStep(1)}>
                <ArrowLeft className="w-4 h-4 mr-1" /> Back
              </Button>
              <Button className="flex-1" onClick={() => validateStep2() && setStep(3)}>
                Continue <ArrowRight className="w-4 h-4 ml-1" />
              </Button>
            </div>
          </div>
        )}

        {/* Step 3: Portfolio & Documents */}
        {step === 3 && (
          <div className="space-y-4">
            <div className="rounded-xl border border-primary/30 bg-primary/5 p-4 flex gap-3">
              <div className="text-2xl">💡</div>
              <div className="space-y-1">
                <p className="text-sm font-semibold text-foreground">Why this matters</p>
                <p className="text-xs text-muted-foreground leading-relaxed">
                  Photos of your tools, equipment, or past work help posters trust you instantly — verified portfolios get hired up to <span className="font-semibold text-foreground">3x faster</span>.
                </p>
              </div>
            </div>
            <div className="rounded-xl border border-border bg-card p-5 space-y-4">
              <div className="text-center space-y-2">
                <FileText className="w-10 h-10 text-primary mx-auto" />
                <h3 className="font-semibold text-foreground">Portfolio & Documents</h3>
                <p className="text-sm text-muted-foreground">
                  Want to help others with tasks? Upload work photos, certifications, or a resume to stand out. <span className="font-medium text-foreground">Only posting tasks? This step is optional.</span>
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
                Up to 10 files · Images, PDFs, or documents · Optional
              </p>
            </div>

            <div className="flex gap-3">
              <Button variant="outline" className="flex-1" onClick={() => setStep(2)}>
                <ArrowLeft className="w-4 h-4 mr-1" /> Back
              </Button>
              <Button
                className="flex-1"
                onClick={createAccountAndEnterStep4}
                disabled={loading}
              >
                {loading
                  ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> Creating account…</>
                  : <>{portfolioFiles.length > 0 ? "Continue" : "Skip"} <ArrowRight className="w-4 h-4 ml-1" /></>}
              </Button>
            </div>
          </div>
        )}

        {/* Step 4: ID verification */}
        {step === 4 && (
          <div className="space-y-4">
            {/* Verified by Stripe badge */}
            <div className="rounded-xl border border-primary/30 bg-primary/5 p-3 flex items-center gap-3">
              <div className="w-9 h-9 rounded-lg bg-primary/15 flex items-center justify-center shrink-0">
                <ShieldCheck className="w-5 h-5 text-primary" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold text-foreground">Verified by Stripe</p>
                <p className="text-xs text-muted-foreground">Bank-grade ID verification. Your data is encrypted end-to-end.</p>
              </div>
            </div>

            {/* Decide which UI to show */}
            {idvMode === null && accountCreated && (
              <IdentityVerificationStep
                onComplete={(outcome) => {
                  setIdvOutcome(outcome);
                  setIdvMode("idv");
                }}
                onFallbackToManual={() => setIdvMode("manual")}
              />
            )}

            {idvMode === "idv" && idvOutcome && (
              <div className="rounded-xl border border-border bg-card p-5 space-y-3 text-center">
                {idvOutcome === "verified" ? (
                  <>
                    <div className="w-14 h-14 rounded-full bg-primary/10 flex items-center justify-center mx-auto">
                      <ShieldCheck className="w-7 h-7 text-primary" />
                    </div>
                    <h3 className="font-semibold text-foreground">You're verified!</h3>
                    <p className="text-sm text-muted-foreground">Your identity was confirmed instantly. Verify your email next to log in.</p>
                  </>
                ) : idvOutcome === "processing" ? (
                  <>
                    <div className="w-14 h-14 rounded-full bg-muted flex items-center justify-center mx-auto">
                      <Loader2 className="w-7 h-7 text-muted-foreground animate-spin" />
                    </div>
                    <h3 className="font-semibold text-foreground">Still processing…</h3>
                    <p className="text-sm text-muted-foreground">Your verification is being reviewed. We'll email you once it's complete.</p>
                  </>
                ) : (
                  <>
                    <div className="w-14 h-14 rounded-full bg-destructive/10 flex items-center justify-center mx-auto">
                      <Upload className="w-7 h-7 text-destructive" />
                    </div>
                    <h3 className="font-semibold text-foreground">We need a closer look</h3>
                    <p className="text-sm text-muted-foreground">Your submission was sent to our review team. We'll email you within 24–48 hours.</p>
                  </>
                )}
              </div>
            )}

            {idvMode === "manual" && (
              <div className="rounded-xl border border-border bg-card p-5 space-y-4">
                <div className="text-center space-y-2">
                  <Upload className="w-10 h-10 text-primary mx-auto" />
                  <h3 className="font-semibold text-foreground">Upload your ID <span className="text-muted-foreground text-xs">(optional)</span></h3>
                  <p className="text-sm text-muted-foreground">
                    Upload a government-issued ID (driver's license, passport, or state ID). Our team will review it within 24–48 hours.
                  </p>
                </div>

                <label className="cursor-pointer block">
                  <div className="border-2 border-dashed border-border rounded-xl p-6 text-center hover:border-primary transition-colors">
                    {idFileName ? (
                      <p className="text-sm text-foreground font-medium">{idFileName}</p>
                    ) : (
                      <p className="text-sm text-muted-foreground">Click to select file (JPG, PNG, or PDF)</p>
                    )}
                  </div>
                  <input type="file" accept="image/*,.pdf" className="hidden" onChange={handleIdChange} />
                </label>
              </div>
            )}

            {/* Sticky Finish & continue button */}
            <div
              className="fixed bottom-0 left-0 right-0 z-40 bg-background/95 backdrop-blur-md border-t border-border px-4 py-3"
              style={{ paddingBottom: "calc(0.75rem + env(safe-area-inset-bottom, 0px))" }}
            >
              <div className="max-w-md mx-auto">
                <Button
                  className="w-full"
                  size="lg"
                  onClick={finishSignup}
                  disabled={loading || (idvMode === null && accountCreated)}
                >
                  Finish & continue <ArrowRight className="w-4 h-4 ml-1" />
                </Button>
              </div>
            </div>
          </div>
        )}

        <p className="text-center text-sm text-muted-foreground">
          Already have an account?{" "}
          <Link to="/login" className="text-primary font-medium hover:underline">Log in</Link>
        </p>
      </div>
      </div>
    </div>
  );
};

export default Signup;
