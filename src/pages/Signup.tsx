import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Upload, Camera, ArrowRight, ArrowLeft } from "lucide-react";

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

  // Step 3 fields
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

  const validateStep1 = () => {
    if (!fullName.trim()) { toast.error("Full name is required"); return false; }
    if (!email.trim()) { toast.error("Email is required"); return false; }
    if (password.length < 6) { toast.error("Password must be at least 6 characters"); return false; }
    return true;
  };

  const validateStep2 = () => {
    if (!bio.trim()) { toast.error("Please tell us about yourself"); return false; }
    if (!location.trim()) { toast.error("Location is required"); return false; }
    return true;
  };

  const validateStep3 = () => {
    if (!idFile) { toast.error("Please upload a proof of ID"); return false; }
    return true;
  };

  const handleSignup = async () => {
    if (!validateStep3()) return;

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

      // 2. Upload avatar if provided
      let avatarUrl: string | null = null;
      if (avatarFile) {
        const ext = avatarFile.name.split(".").pop();
        const path = `${userId}/avatar.${ext}`;
        const { error: avatarErr } = await supabase.storage
          .from("job-photos")
          .upload(path, avatarFile, { upsert: true });
        if (!avatarErr) {
          const { data: urlData } = supabase.storage.from("job-photos").getPublicUrl(path);
          avatarUrl = urlData.publicUrl;
        }
      }

      // 3. Upload ID document
      const idExt = idFile!.name.split(".").pop();
      const idPath = `${userId}/id-document.${idExt}`;
      const { error: idErr } = await supabase.storage
        .from("id-documents")
        .upload(idPath, idFile!, { upsert: true });
      if (idErr) throw new Error("Failed to upload ID document");

      // 4. Update profile with detailed info
      await supabase
        .from("profiles")
        .update({
          phone,
          bio,
          location,
          skills: skills || null,
          avatar_url: avatarUrl,
          id_document_url: idPath,
          approval_status: "pending",
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

  return (
    <div className="min-h-screen flex items-center justify-center bg-background px-4 py-12">
      <div className="w-full max-w-md space-y-8">
        <div className="text-center">
          <Link to="/" className="text-3xl font-display font-bold text-primary">
            Helpr
          </Link>
          <p className="mt-2 text-muted-foreground">Create your account</p>
          {/* Step indicator */}
          <div className="flex items-center justify-center gap-2 mt-4">
            {[1, 2, 3].map((s) => (
              <div
                key={s}
                className={`h-2 rounded-full transition-all ${
                  s === step ? "w-8 bg-primary" : s < step ? "w-8 bg-primary/40" : "w-8 bg-border"
                }`}
              />
            ))}
          </div>
          <p className="text-xs text-muted-foreground mt-2">
            Step {step} of 3: {step === 1 ? "Account details" : step === 2 ? "Your profile" : "Verify identity"}
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
            {/* Avatar upload */}
            <div className="flex flex-col items-center gap-3">
              <Label>Profile picture <span className="text-muted-foreground text-xs">(optional)</span></Label>
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

        {/* Step 3: ID verification */}
        {step === 3 && (
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
              Your ID will be securely stored and only reviewed by admins for verification purposes. Your profile will be pending until approved.
            </p>

            <div className="flex gap-3">
              <Button variant="outline" className="flex-1" onClick={() => setStep(2)}>
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
          <Link to="/login" className="text-primary font-medium hover:underline">
            Log in
          </Link>
        </p>
      </div>
    </div>
  );
};

export default Signup;
