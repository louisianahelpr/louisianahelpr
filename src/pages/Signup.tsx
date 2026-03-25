import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Upload, Camera, ArrowRight, ArrowLeft, FileText, X, ImagePlus, Gift, Loader2, Eye, EyeOff } from "lucide-react";
import { Checkbox } from "@/components/ui/checkbox";
import { useSearchParams } from "react-router-dom";
import { usePageTitle } from "@/hooks/usePageTitle";

const SIGNUP_COOLDOWN_MS = 60_000; // 1 minute between attempts
const SIGNUP_COOLDOWN_KEY = "helpr_signup_last";

const Signup = () => {
  const navigate = useNavigate();
  usePageTitle("Sign Up — Helpr");
  const [searchParams] = useSearchParams();
  const [step, setStep] = useState(1);
  const [loading, setLoading] = useState(false);

  // Step 1 fields
  const [fullName, setFullName] = useState("");
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

  // Step 4 fields
  const [idFile, setIdFile] = useState<File | null>(null);
  const [idFileName, setIdFileName] = useState("");

  const handleAvatarChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      setAvatarFile(file);
      setAvatarPreview(URL.createObjectURL(file));
    }
  };

  const handleIdChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      setIdFile(file);
      setIdFileName(file.name);
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

  const validateStep1 = () => {
    if (!fullName.trim()) { toast.error("Full name is required"); return false; }
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
    return true;
  };

  const validateStep2 = () => {
    if (!avatarFile) { toast.error("Profile picture is required"); return false; }
    if (!bio.trim() || bio.trim().length < 100) { toast.error("About you must be at least 100 characters"); return false; }
    if (!location.trim()) { toast.error("City is required"); return false; }
    return true;
  };

  const validateStep4 = () => {
    // ID upload is optional — users can skip and upload later
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

    const portfolioData = [];
    for (const file of portfolioFiles) {
      portfolioData.push({
        base64: await fileToBase64(file),
        ext: file.name.split(".").pop(),
        contentType: file.type,
      });
    }

    return { avatarBase64, avatarExt, idBase64, idExt, portfolioData };
  };

  const completeProfile = async (userId: string) => {
    const { avatarBase64, avatarExt, idBase64, idExt, portfolioData } = await prepareFileData();

    const { data: result, error: fnError } = await supabase.functions.invoke("complete-signup", {
      body: {
        userId,
        avatarBase64,
        avatarExt,
        avatarContentType: avatarFile?.type,
        idBase64,
        idExt,
        idContentType: idFile?.type,
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

    if (fnError || result?.error) {
      console.error("Signup completion error:", fnError || result?.error);
    }
  };

  const handleSignup = async () => {
    if (!validateStep4()) return;

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
      // 1. Create account
      const { data: authData, error: authError } = await supabase.auth.signUp({
        email,
        password,
        options: {
          emailRedirectTo: `${window.location.origin}/account-pending`,
          data: { full_name: fullName, role: "customer" },
        },
      });

      // If user already exists, check their status — don't auto-sign-in denied users
      if (authError && (authError.message.includes("already registered") || authError.message.includes("already been registered"))) {
        toast.error("An account with this email already exists. Please log in instead.");
        setLoading(false);
        return;
      }

      if (authError) throw authError;
      const userId = authData.user?.id;
      if (!userId) throw new Error("Account creation failed");

      // 2. Complete profile with uploads
      await completeProfile(userId);

      // 3. Process referral code if provided
      if (referralCode.trim()) {
        try {
          await supabase.rpc("process_referral", {
            p_referral_code: referralCode.trim().toUpperCase(),
            p_new_user_id: userId,
          });
        } catch (refErr) {
          console.log("Referral processing skipped:", refErr);
        }
      }

      toast.success("Account created! Please check your email to verify.");
      navigate("/signup-pending");
    } catch (err: any) {
      toast.error(err.message || "Signup failed");
    } finally {
      setLoading(false);
    }
  };

  const totalSteps = 4;

  return (
    <div className="min-h-screen flex items-center justify-center bg-background px-4 py-12">
      <div className="w-full max-w-md space-y-8">
        <div className="text-center">
          <Link to="/" className="text-3xl font-display font-bold text-primary">Helpr</Link>
          <p className="mt-2 text-muted-foreground">Create your account</p>
          <div className="flex items-center justify-center gap-2 mt-4">
            {[1, 2, 3, 4].map((s) => (
              <div
                key={s}
                className={`h-2 rounded-full transition-all ${
                  s === step ? "w-8 bg-primary" : s < step ? "w-8 bg-primary/40" : "w-8 bg-border"
                }`}
              />
            ))}
          </div>
          <p className="text-xs text-muted-foreground mt-2">
            Step {step} of {totalSteps}:{" "}
            {step === 1 ? "Account details" : step === 2 ? "Your profile" : step === 3 ? "Portfolio & docs" : "Verify identity"}
          </p>
        </div>

        {/* Step 1: Account basics */}
        {step === 1 && (
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="name">Full name <span className="text-destructive">*</span></Label>
              <Input id="name" placeholder="Jane Doe" value={fullName} onChange={(e) => setFullName(e.target.value)} required />
            </div>
            <div className="space-y-2">
              <Label htmlFor="email">Email <span className="text-destructive">*</span></Label>
              <Input id="email" type="email" placeholder="you@example.com" value={email} onChange={(e) => setEmail(e.target.value)} required />
            </div>
            <div className="space-y-2">
              <Label htmlFor="confirmEmail">Confirm email <span className="text-destructive">*</span></Label>
              <Input id="confirmEmail" type="email" placeholder="Re-enter your email" value={confirmEmail} onChange={(e) => setConfirmEmail(e.target.value)} required />
              {confirmEmail && (
                <p className={`text-xs ${email === confirmEmail ? "text-primary" : "text-destructive"}`}>
                  {email === confirmEmail ? "✓ Emails match" : "✗ Emails do not match"}
                </p>
              )}
            </div>
            <div className="space-y-2">
              <Label htmlFor="password">Password <span className="text-destructive">*</span></Label>
              <div className="relative">
                <Input id="password" type={showPassword ? "text" : "password"} placeholder="At least 6 characters" value={password} onChange={(e) => setPassword(e.target.value)} required minLength={6} className="pr-10" />
                <button type="button" onClick={() => setShowPassword(!showPassword)} className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors">
                  {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="confirmPassword">Confirm password <span className="text-destructive">*</span></Label>
              <div className="relative">
                <Input id="confirmPassword" type={showConfirmPassword ? "text" : "password"} placeholder="Re-enter your password" value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)} required minLength={6} className="pr-10" />
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
              <Label htmlFor="dob">Date of birth <span className="text-destructive text-xs">*</span></Label>
              <Input id="dob" type="date" value={dateOfBirth} onChange={(e) => setDateOfBirth(e.target.value)} required max={new Date(new Date().getFullYear() - 18, new Date().getMonth(), new Date().getDate()).toISOString().split("T")[0]} />
              <p className="text-xs text-muted-foreground">You must be at least 18 years old</p>
            </div>
            <div className="space-y-2">
              <Label htmlFor="phone">Phone number <span className="text-destructive text-xs">*</span></Label>
              <Input id="phone" type="tel" placeholder="(555) 123-4567" value={phone} onChange={(e) => setPhone(e.target.value)} required />
            </div>
            <div className="space-y-2">
              <Label htmlFor="referral" className="flex items-center gap-1.5">
                <Gift className="w-3.5 h-3.5 text-primary" /> Referral code <span className="text-muted-foreground text-xs">(optional)</span>
              </Label>
              <Input
                id="referral"
                placeholder="Enter referral code for $5 credit"
                value={referralCode}
                onChange={(e) => setReferralCode(e.target.value.toUpperCase())}
                maxLength={10}
                className="uppercase"
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
            <Button className="w-full" size="lg" onClick={() => validateStep1() && setStep(2)} disabled={!acceptedPolicies}>
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
              <Label htmlFor="bio">About you <span className="text-destructive">*</span></Label>
              <Textarea
                id="bio"
                placeholder="Tell us about yourself, your experience, and what you're looking for… (minimum 100 characters)"
                value={bio}
                onChange={(e) => setBio(e.target.value)}
                rows={4}
                required
                minLength={100}
              />
              <p className={`text-xs ${bio.trim().length >= 100 ? "text-primary" : "text-muted-foreground"}`}>
                {bio.trim().length}/100 characters minimum {bio.trim().length >= 100 && "✓"}
              </p>
            </div>
            <div className="space-y-2">
              <Label htmlFor="location">City <span className="text-destructive">*</span></Label>
              <Input id="location" placeholder="e.g. Baton Rouge, LA" value={location} onChange={(e) => setLocation(e.target.value)} required />
            </div>
            <div className="space-y-2">
              <Label htmlFor="skills">Skills <span className="text-muted-foreground text-xs">(optional — recommended for helprs)</span></Label>
              <Input id="skills" placeholder="Type your skills, separated by commas" value={skills} onChange={(e) => setSkills(e.target.value)} />
              <div className="flex flex-wrap gap-1.5">
                {["Cleaning", "Moving", "Handyman", "Yard Work", "Painting", "Delivery", "Pet Care", "Errands", "Assembly"].map((skill) => {
                  const isActive = skills.toLowerCase().includes(skill.toLowerCase());
                  return (
                    <button
                      key={skill}
                      type="button"
                      onClick={() => {
                        if (isActive) {
                          setSkills(skills.split(",").map(s => s.trim()).filter(s => s.toLowerCase() !== skill.toLowerCase()).join(", "));
                        } else {
                          setSkills(skills ? `${skills}, ${skill}` : skill);
                        }
                      }}
                      className={`px-2.5 py-1 rounded-full text-xs font-medium border transition-colors ${
                        isActive
                          ? "bg-primary text-primary-foreground border-primary"
                          : "bg-secondary/50 text-muted-foreground border-border hover:border-primary/50"
                      }`}
                    >
                      {isActive ? "✓ " : "+ "}{skill}
                    </button>
                  );
                })}
              </div>
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
              <div className="grid grid-cols-2 gap-2">
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
              <Button className="flex-1" onClick={() => setStep(4)}>
                {portfolioFiles.length > 0 ? "Continue" : "Skip"} <ArrowRight className="w-4 h-4 ml-1" />
              </Button>
            </div>
          </div>
        )}

        {/* Step 4: ID verification */}
        {step === 4 && (
          <div className="space-y-4">
            <div className="rounded-xl border border-border bg-card p-5 space-y-4">
              <div className="text-center space-y-2">
                <Upload className="w-10 h-10 text-primary mx-auto" />
                <h3 className="font-semibold text-foreground">Verify your identity <span className="text-muted-foreground text-xs">(optional)</span></h3>
                <p className="text-sm text-muted-foreground">
                  Upload a government-issued ID (driver's license, passport, or state ID). This helps verify your identity and builds trust in the community.
                </p>
                <p className="text-xs text-muted-foreground italic">You can skip this step and upload later from your profile. ID verification is required before accepting tasks as a helpr.</p>
              </div>

              <label className="cursor-pointer block">
                <div className="border-2 border-dashed border-border rounded-lg p-6 text-center hover:border-primary transition-colors">
                  {idFileName ? (
                    <p className="text-sm text-foreground font-medium">{idFileName}</p>
                  ) : (
                    <p className="text-sm text-muted-foreground">Click to select file (JPG, PNG, or PDF)</p>
                  )}
                </div>
                <input type="file" accept="image/*,.pdf" className="hidden" onChange={handleIdChange} />
              </label>
            </div>

            <p className="text-xs text-muted-foreground text-center">
              Your ID will be securely stored and only reviewed by admins for verification purposes.
            </p>

            <div className="flex gap-3">
              <Button variant="outline" className="flex-1" onClick={() => setStep(3)}>
                <ArrowLeft className="w-4 h-4 mr-1" /> Back
              </Button>
              <Button className="flex-1" size="lg" onClick={handleSignup} disabled={loading}>
                {loading ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> Creating account…</> : "Submit for review"}
              </Button>
            </div>
          </div>
        )}

        <p className="text-center text-sm text-muted-foreground">
          Already have an account?{" "}
          <Link to="/login" className="text-primary font-medium hover:underline">Log in</Link>
        </p>
      </div>
    </div>
  );
};

export default Signup;
