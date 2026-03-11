import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Upload, Camera, ArrowRight, ArrowLeft, FileText, X, ImagePlus, Gift } from "lucide-react";
import { useSearchParams } from "react-router-dom";

const Signup = () => {
  const navigate = useNavigate();
  const [step, setStep] = useState(1);
  const [loading, setLoading] = useState(false);

  // Step 1 fields
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [phone, setPhone] = useState("");

  // Step 2 fields
  const [bio, setBio] = useState("");
  const [location, setLocation] = useState("");
  const [skills, setSkills] = useState("");
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
    if (password.length < 6) { toast.error("Password must be at least 6 characters"); return false; }
    return true;
  };

  const validateStep2 = () => {
    if (!avatarFile) { toast.error("Profile picture is required"); return false; }
    if (!bio.trim()) { toast.error("Please tell us about yourself"); return false; }
    if (!location.trim()) { toast.error("Location is required"); return false; }
    return true;
  };

  const validateStep4 = () => {
    if (!idFile) { toast.error("Please upload a proof of ID"); return false; }
    return true;
  };

  const handleSignup = async () => {
    if (!validateStep4()) return;

    setLoading(true);
    try {
      // 1. Create account
      const { data: authData, error: authError } = await supabase.auth.signUp({
        email,
        password,
        options: {
          emailRedirectTo: window.location.origin,
          data: { full_name: fullName, role: "customer" },
        },
      });

      if (authError) throw authError;
      const userId = authData.user?.id;
      if (!userId) throw new Error("Account creation failed");

      // 2. Upload avatar
      let avatarUrl: string | null = null;
      const avatarExt = avatarFile!.name.split(".").pop();
      const avatarPath = `${userId}/avatar.${avatarExt}`;
      const { error: avatarErr } = await supabase.storage
        .from("job-photos")
        .upload(avatarPath, avatarFile!, { upsert: true });
      if (avatarErr) throw new Error("Failed to upload profile picture");
      const { data: urlData } = supabase.storage.from("job-photos").getPublicUrl(avatarPath);
      avatarUrl = urlData.publicUrl;

      // 3. Upload ID document
      const idExt = idFile!.name.split(".").pop();
      const idBase64 = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve((reader.result as string).split(",")[1]);
        reader.onerror = reject;
        reader.readAsDataURL(idFile!);
      });

      const { data: uploadRes, error: uploadErr } = await supabase.functions.invoke("upload-id-document", {
        body: { userId, fileBase64: idBase64, fileName: `id-document.${idExt}`, contentType: idFile!.type },
      });

      if (uploadErr || uploadRes?.error) throw new Error("Failed to upload ID document");

      // 4. Upload portfolio files
      const portfolioUrls: string[] = [];
      for (const file of portfolioFiles) {
        const ext = file.name.split(".").pop();
        const path = `${userId}/${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`;
        const { error: pErr } = await supabase.storage.from("user-documents").upload(path, file);
        if (!pErr) {
          const { data: pUrl } = supabase.storage.from("user-documents").getPublicUrl(path);
          portfolioUrls.push(pUrl.publicUrl);
        }
      }

      // 5. Update profile
      await supabase
        .from("profiles")
        .update({
          phone,
          bio,
          location,
          skills: skills || null,
          avatar_url: avatarUrl,
          id_document_url: `${userId}/id-document.${idExt}`,
          approval_status: "pending",
          portfolio_urls: portfolioUrls.length > 0 ? portfolioUrls : [],
        })
        .eq("user_id", userId);

      toast.success("Account created! Your profile is pending admin review.");
      navigate("/dashboard");
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
              <Label htmlFor="name">Full name</Label>
              <Input id="name" placeholder="Jane Doe" value={fullName} onChange={(e) => setFullName(e.target.value)} required />
            </div>
            <div className="space-y-2">
              <Label htmlFor="email">Email</Label>
              <Input id="email" type="email" placeholder="you@example.com" value={email} onChange={(e) => setEmail(e.target.value)} required />
            </div>
            <div className="space-y-2">
              <Label htmlFor="password">Password</Label>
              <Input id="password" type="password" placeholder="At least 6 characters" value={password} onChange={(e) => setPassword(e.target.value)} required minLength={6} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="phone">Phone number <span className="text-muted-foreground text-xs">(optional)</span></Label>
              <Input id="phone" type="tel" placeholder="(555) 123-4567" value={phone} onChange={(e) => setPhone(e.target.value)} />
            </div>
            <Button className="w-full" size="lg" onClick={() => validateStep1() && setStep(2)}>
              Continue <ArrowRight className="w-4 h-4 ml-1" />
            </Button>
          </div>
        )}

        {/* Step 2: Profile details */}
        {step === 2 && (
          <div className="space-y-4">
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
              <Label htmlFor="bio">About you</Label>
              <Textarea
                id="bio"
                placeholder="Tell us about yourself, your experience, and what you're looking for…"
                value={bio}
                onChange={(e) => setBio(e.target.value)}
                rows={3}
                required
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="location">Location</Label>
              <Input id="location" placeholder="City, State" value={location} onChange={(e) => setLocation(e.target.value)} required />
            </div>
            <div className="space-y-2">
              <Label htmlFor="skills">Skills <span className="text-muted-foreground text-xs">(optional)</span></Label>
              <Input id="skills" placeholder="e.g. cleaning, moving, handyman" value={skills} onChange={(e) => setSkills(e.target.value)} />
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
                  Upload previous work photos, certifications, resume, or any documents that showcase your experience.
                </p>
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
                <h3 className="font-semibold text-foreground">Upload proof of ID</h3>
                <p className="text-sm text-muted-foreground">
                  Upload a government-issued ID (driver's license, passport, or state ID). This is required for verification.
                </p>
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
                {loading ? "Creating account…" : "Submit for review"}
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
