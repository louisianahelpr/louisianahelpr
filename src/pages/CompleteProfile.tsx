import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { supabase } from "@/integrations/supabase/client";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { useQueryClient } from "@tanstack/react-query";
import { usePageTitle } from "@/hooks/usePageTitle";
import { toast } from "sonner";
import { Camera, FileText, Loader2, ShieldCheck, X } from "lucide-react";

const ALLOWED_IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp", "image/gif"];
const ALLOWED_DOC_TYPES = [...ALLOWED_IMAGE_TYPES, "application/pdf"];
const MAX_FILE_SIZE = 5 * 1024 * 1024;

const sanitizeExt = (name: string) => {
  const ext = name.split(".").pop()?.toLowerCase().replace(/[^a-z0-9]/g, "") || "bin";
  return ext.slice(0, 5);
};

const withTimeout = async <T,>(promise: Promise<T>, label: string, ms = 20000): Promise<T> => {
  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timeoutId = setTimeout(() => reject(new Error(`${label} timed out. Please check your connection and try again.`)), ms);
  });

  try {
    return await Promise.race([promise, timeout]);
  } finally {
    if (timeoutId) clearTimeout(timeoutId);
  }
};

const formatPhone = (raw: string) => {
  const digits = raw.replace(/\D/g, "").slice(0, 10);
  if (digits.length === 0) return "";
  if (digits.length < 4) return `(${digits}`;
  if (digits.length < 7) return `(${digits.slice(0, 3)}) ${digits.slice(3)}`;
  return `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`;
};

const CompleteProfile = () => {
  usePageTitle("Complete your profile — Helpr");
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { user, profile, isLoading } = useCurrentUser();

  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [dateOfBirth, setDateOfBirth] = useState("");
  const [phone, setPhone] = useState("");
  const [location, setLocation] = useState("");
  const [bio, setBio] = useState("");
  const [acceptedPolicies, setAcceptedPolicies] = useState(false);

  const [avatarFile, setAvatarFile] = useState<File | null>(null);
  const [avatarPreview, setAvatarPreview] = useState<string | null>(null);
  const [idFile, setIdFile] = useState<File | null>(null);
  const [idPreview, setIdPreview] = useState<string | null>(null);

  const [submitting, setSubmitting] = useState(false);

  // Hydrate any existing values (so we only ask for what's missing)
  useEffect(() => {
    if (!profile) return;
    const fn = profile.full_name?.split(" ") ?? [];
    if (fn.length > 0 && !firstName) setFirstName(fn[0] ?? "");
    if (fn.length > 1 && !lastName) setLastName(fn.slice(1).join(" "));
    if (profile.date_of_birth && !dateOfBirth) setDateOfBirth(profile.date_of_birth);
    if (profile.phone && !phone) setPhone(formatPhone(profile.phone));
    if (profile.location && !location) setLocation(profile.location);
    if (profile.bio && !bio) setBio(profile.bio);
    if (profile.avatar_url && !avatarPreview) setAvatarPreview(profile.avatar_url);
    if (profile.id_document_url && !idPreview) setIdPreview(profile.id_document_url);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profile?.user_id]);

  const validateFile = (file: File, allowedTypes: string[], label: string): boolean => {
    if (!allowedTypes.includes(file.type)) {
      toast.error(`${label}: Invalid file type.`);
      return false;
    }
    if (file.size > MAX_FILE_SIZE) {
      toast.error(`${label}: Maximum 5MB.`);
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

  const ageOk = useMemo(() => {
    if (!dateOfBirth) return false;
    const dob = new Date(dateOfBirth);
    const today = new Date();
    let age = today.getFullYear() - dob.getFullYear();
    const m = today.getMonth() - dob.getMonth();
    if (m < 0 || (m === 0 && today.getDate() < dob.getDate())) age--;
    return age >= 18;
  }, [dateOfBirth]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user) return;

    if (!firstName.trim() || !lastName.trim()) return toast.error("Please enter your full name");
    if (!dateOfBirth) return toast.error("Date of birth is required");
    if (!ageOk) return toast.error("You must be at least 18");
    if (!phone.trim() || phone.replace(/\D/g, "").length < 10) return toast.error("Valid phone number is required");
    if (!location.trim()) return toast.error("City is required");
    if (!bio.trim() || bio.trim().length < 20) return toast.error("Tell us about yourself (at least 20 characters)");
    if (!avatarFile && !profile?.avatar_url) return toast.error("Profile picture is required");
    if (!idFile && !profile?.id_document_url) return toast.error("Government-issued ID is required");
    if (!acceptedPolicies) return toast.error("Please accept the platform rules, terms, and privacy policy");

    setSubmitting(true);
    try {
      const fullName = `${firstName.trim()} ${lastName.trim()}`;

      // Persist the user's name on auth metadata so OAuth-derived names get updated too.
      // Do not block profile completion on this optional metadata write.
      void supabase.auth.updateUser({ data: { full_name: fullName } });

      // Upload files directly to Storage in parallel (much faster than base64-through-edge-function)
      let avatarUrl: string | null = null;
      let idDocumentPath: string | null = null;

      const uploads: Promise<void>[] = [];

      if (avatarFile) {
        const ext = sanitizeExt(avatarFile.name);
        const path = `${user.id}/avatar.${ext}`;
        uploads.push(
          supabase.storage
            .from("user-documents")
            .upload(path, avatarFile, { upsert: true, contentType: avatarFile.type })
            .then(({ error }) => {
              if (error) throw error;
              const { data } = supabase.storage.from("user-documents").getPublicUrl(path);
              avatarUrl = `${data.publicUrl}?t=${Date.now()}`;
            })
        );
      }

      if (idFile) {
        const ext = sanitizeExt(idFile.name);
        const path = `${user.id}/id-document.${ext}`;
        uploads.push(
          supabase.storage
            .from("id-documents")
            .upload(path, idFile, { upsert: true, contentType: idFile.type })
            .then(({ error }) => {
              if (error) throw error;
              idDocumentPath = path;
            })
        );
      }

      if (uploads.length) await withTimeout(Promise.all(uploads), "File upload");

      // Single, lightweight DB update — no large JSON over the wire
      const updates: {
        full_name: string;
        phone: string;
        bio: string;
        location: string;
        date_of_birth: string;
        approval_status: string;
        avatar_url?: string;
        id_document_url?: string;
      } = {
        full_name: fullName,
        phone: phone.trim(),
        bio: bio.trim(),
        location: location.trim(),
        date_of_birth: dateOfBirth,
        approval_status: "pending",
      };
      if (avatarUrl) updates.avatar_url = avatarUrl;
      if (idDocumentPath) updates.id_document_url = idDocumentPath;

      const { error: updateErr } = await withTimeout(
        Promise.resolve(
          supabase
            .from("profiles")
            .update(updates)
            .eq("user_id", user.id)
        ),
        "Profile save",
      );
      if (updateErr) throw updateErr;

      await queryClient.invalidateQueries({ queryKey: ["currentUser", user.id] });
      toast.success("Profile complete — welcome to Helpr!");
      navigate("/dashboard", { replace: true });
    } catch (err: any) {
      toast.error(err?.message || "Could not save your profile");
    } finally {
      setSubmitting(false);
    }
  };

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-premium-page">
        <Loader2 className="w-6 h-6 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-b from-background to-secondary/20">
      <div className="flex items-start justify-center px-5 py-8 sm:py-12">
        <div className="w-full max-w-md pb-12">
          <div className="text-center mb-6">
            <h1 className="text-3xl font-display font-bold text-primary">Almost there</h1>
            <p className="mt-2 text-sm text-muted-foreground">
              We need a few details before you can use Helpr. This keeps the community safe.
            </p>
            <p className="mt-2 text-xs text-muted-foreground">
              All fields marked <span className="text-destructive">*</span> are required.
            </p>
          </div>

          <form
            onSubmit={handleSubmit}
            className="rounded-2xl border border-border/60 bg-card shadow-[var(--card-shadow)] p-6 sm:p-7 space-y-5"
          >
            {/* Circular profile picture uploader — top of form */}
            <div className="flex flex-col items-center gap-2 -mt-1">
              <label
                htmlFor="avatar"
                className="group relative cursor-pointer"
                aria-label={avatarPreview ? "Change profile picture" : "Upload profile picture"}
              >
                <div className="w-24 h-24 rounded-full overflow-hidden ring-2 ring-border bg-muted flex items-center justify-center transition-all group-hover:ring-primary/50">
                  {avatarPreview ? (
                    <img src={avatarPreview} alt="Profile preview" className="w-full h-full object-cover" />
                  ) : (
                    <Camera className="w-7 h-7 text-muted-foreground" />
                  )}
                </div>
                <div className="absolute bottom-0 right-0 w-7 h-7 rounded-full bg-primary text-primary-foreground flex items-center justify-center shadow-md ring-2 ring-card">
                  <Camera className="w-3.5 h-3.5" />
                </div>
                <input
                  id="avatar"
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={handleAvatarChange}
                />
              </label>
              <p className="text-xs text-muted-foreground">
                {avatarPreview
                  ? "Tap to change · JPG, PNG, WebP (5MB max)"
                  : <>Profile photo <span className="text-destructive">*</span> · tap to add</>}
              </p>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="firstName">First name <span className="text-destructive">*</span></Label>
                <Input
                  id="firstName"
                  autoComplete="given-name"
                  value={firstName}
                  onChange={(e) => setFirstName(e.target.value)}
                  className="rounded-xl"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="lastName">Last name <span className="text-destructive">*</span></Label>
                <Input
                  id="lastName"
                  autoComplete="family-name"
                  value={lastName}
                  onChange={(e) => setLastName(e.target.value)}
                  className="rounded-xl"
                />
              </div>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="dob">Date of birth (must be 18+) <span className="text-destructive">*</span></Label>
              <Input
                id="dob"
                type="date"
                autoComplete="bday"
                value={dateOfBirth}
                onChange={(e) => setDateOfBirth(e.target.value)}
                className="rounded-xl"
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="phone">Phone <span className="text-destructive">*</span></Label>
              <Input
                id="phone"
                type="tel"
                autoComplete="tel"
                placeholder="(225) 555-0123"
                value={phone}
                onChange={(e) => setPhone(formatPhone(e.target.value))}
                className="rounded-xl"
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="city">City <span className="text-destructive">*</span></Label>
              <Input
                id="city"
                autoComplete="address-level2"
                placeholder="Baton Rouge"
                value={location}
                onChange={(e) => setLocation(e.target.value)}
                className="rounded-xl"
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="bio">About you <span className="text-destructive">*</span></Label>
              <Textarea
                id="bio"
                rows={3}
                placeholder="A short intro neighbors will see on your profile (20+ characters)."
                value={bio}
                onChange={(e) => setBio(e.target.value)}
                className="rounded-xl"
              />
            </div>

            {/* ID */}
            <div className="space-y-1.5">
              <Label>Government-issued ID <span className="text-destructive">*</span></Label>
              <label
                htmlFor="id-doc"
                className="flex items-center gap-3 rounded-xl border border-dashed border-border p-3 cursor-pointer hover:bg-muted/40"
              >
                {idPreview ? (
                  <img src={idPreview} alt="ID preview" className="w-14 h-14 rounded-md object-cover" />
                ) : (
                  <div className="w-14 h-14 rounded-md bg-muted flex items-center justify-center">
                    <FileText className="w-5 h-5 text-muted-foreground" />
                  </div>
                )}
                <div className="text-sm">
                  <div className="font-medium">
                    {idFile ? idFile.name : profile?.id_document_url ? "Replace ID" : "Upload your ID"}
                  </div>
                  <div className="text-muted-foreground text-xs">Image or PDF. Max 5MB.</div>
                </div>
                <input
                  id="id-doc"
                  type="file"
                  accept="image/*,application/pdf"
                  className="hidden"
                  onChange={handleIdChange}
                />
              </label>
            </div>

            <label className="flex items-start gap-2.5 text-sm text-muted-foreground">
              <Checkbox
                checked={acceptedPolicies}
                onCheckedChange={(v) => setAcceptedPolicies(v === true)}
                className="mt-0.5"
              />
              <span>
                I agree to the{" "}
                <a href="/rules" target="_blank" rel="noreferrer" className="text-primary underline">platform rules</a>,{" "}
                <a href="/terms" target="_blank" rel="noreferrer" className="text-primary underline">terms</a>, and{" "}
                <a href="/privacy" target="_blank" rel="noreferrer" className="text-primary underline">privacy policy</a>. <span className="text-destructive">*</span>
              </span>
            </label>

            <Button
              type="submit"
              size="lg"
              className="w-full rounded-xl"
              disabled={submitting}
            >
              {submitting ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <ShieldCheck className="w-4 h-4 mr-2" />}
              {submitting ? "Saving…" : "Finish & continue"}
            </Button>

            <Button
              type="button"
              variant="outline"
              size="lg"
              onClick={async () => {
                await supabase.auth.signOut();
                navigate("/login", { replace: true });
              }}
              className="w-full rounded-xl"
            >
              <X className="w-4 h-4 mr-2" /> Sign out
            </Button>
          </form>
        </div>
      </div>
    </div>
  );
};

export default CompleteProfile;
