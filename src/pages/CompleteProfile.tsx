import { useEffect, useMemo, useState } from "react";
import { Navigate, useNavigate } from "react-router-dom";
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
import { Camera, Check, FileText, Loader2, ShieldCheck, X } from "lucide-react";
import { DateOfBirthPicker } from "@/components/DateOfBirthPicker";
import { cn } from "@/lib/utils";
import { isProfileComplete } from "@/components/ProtectedRoute";
import { splitName } from "@/lib/splitName";
import { queryKeys } from "@/lib/queryKeys";

const ALLOWED_IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp", "image/gif"];
const ALLOWED_DOC_TYPES = [...ALLOWED_IMAGE_TYPES, "application/pdf"];
const MAX_FILE_SIZE = 5 * 1024 * 1024;

const sanitizeExt = (name: string) => {
  const ext = name.split(".").pop()?.toLowerCase().replace(/[^a-z0-9]/g, "") || "bin";
  return ext.slice(0, 5);
};

const withTimeout = async <T,>(promise: Promise<T>, label: string, ms = 60000): Promise<T> => {
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
  const { user, profile, isLoading, refresh } = useCurrentUser();

  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [dateOfBirth, setDateOfBirth] = useState("");
  const [phone, setPhone] = useState("");
  const [location, setLocation] = useState("");
  const [bio, setBio] = useState("");
  // Hydrated from profile.accepted_terms_at on mount so users who already
  // accepted (and were bounced back here for some other missing field, or who
  // simply refreshed the page) don't have to re-tick the box.
  const [acceptedPolicies, setAcceptedPolicies] = useState(false);

  const [avatarFile, setAvatarFile] = useState<File | null>(null);
  const [avatarPreview, setAvatarPreview] = useState<string | null>(null);
  const [idFile, setIdFile] = useState<File | null>(null);
  const [idPreview, setIdPreview] = useState<string | null>(null);

  const [submitting, setSubmitting] = useState(false);

  // Hydrate any existing values (so we only ask for what's missing)
  useEffect(() => {
    if (!profile) return;
    const { firstName: parsedFirst, lastName: parsedLast } = splitName(profile.full_name);
    if (parsedFirst && !firstName) setFirstName(parsedFirst);
    if (parsedLast && !lastName) setLastName(parsedLast);
    if (profile.date_of_birth && !dateOfBirth) setDateOfBirth(profile.date_of_birth);
    if (profile.phone && !phone) setPhone(formatPhone(profile.phone));
    if (profile.location && !location) setLocation(profile.location);
    if (profile.bio && !bio) setBio(profile.bio);
    if (profile.avatar_url && !avatarPreview) setAvatarPreview(profile.avatar_url);
    if (profile.id_document_url && !idPreview) setIdPreview(profile.id_document_url);
    // Persisted terms acceptance — read straight from the row so refresh / re-entry
    // doesn't reset the user's previous "yes I agree".
    if (profile.accepted_terms_at) setAcceptedPolicies(true);
     
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

  // Live "Big 7" checklist — mirrors ProtectedRoute's gate so the user can
  // see exactly which fields still need attention. Each item is satisfied
  // either by the local form state OR by an existing value already on
  // the profile row (e.g. an avatar uploaded previously).
  const checklist = useMemo(() => {
    const phoneDigits = phone.replace(/\D/g, "");
    return [
      { label: "Full name", done: firstName.trim().length > 0 && lastName.trim().length > 0 },
      { label: "Profile picture", done: Boolean(avatarFile || profile?.avatar_url) },
      { label: "About you (20+ characters)", done: bio.trim().length >= 20 },
      { label: "Date of birth (18+)", done: Boolean(dateOfBirth) && ageOk },
      { label: "Phone number", done: phoneDigits.length === 10 },
      { label: "City", done: location.trim().length > 0 },
      { label: "Government-issued ID", done: Boolean(idFile || profile?.id_document_url) },
      { label: "Accept platform rules, terms & privacy", done: acceptedPolicies },
    ];
  }, [
    firstName,
    lastName,
    avatarFile,
    profile?.avatar_url,
    bio,
    dateOfBirth,
    ageOk,
    phone,
    location,
    idFile,
    profile?.id_document_url,
    acceptedPolicies,
  ]);

  const allComplete = checklist.every((c) => c.done);

  useEffect(() => {
    if (!user?.id || profile || isLoading) return;
    void refresh();
    const retry = window.setInterval(() => void refresh(), 2500);
    return () => window.clearInterval(retry);
     
  }, [user?.id, Boolean(profile), isLoading]);

  const recoverCompletedProfile = async () => {
    if (!user?.id) return false;
    try {
      const { data, error } = await withTimeout(
        Promise.resolve(supabase.from("profiles").select("*").eq("user_id", user.id).maybeSingle()),
        "Profile check",
        12000,
      );
      if (error || !data || !(data.is_legacy_user === true || isProfileComplete(data))) return false;

      queryClient.setQueryData(queryKeys.currentUser.byId(user.id), (current: any) => ({
        ...(current ?? {}),
        profile: data,
        isAdmin: current?.isAdmin ?? false,
      }));
      toast.success("Your profile was already saved — opening Helpr.");
      navigate("/dashboard", { replace: true });
      return true;
    } catch {
      return false;
    }
  };

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

      // Note: full_name is persisted to the profiles table below. We intentionally
      // skip supabase.auth.updateUser() here because it grabs the auth lock and can
      // collide with the session's autoRefreshToken loop, producing
      // "Acquiring an exclusive Navigator LockManager lock ... lock stolen" errors.

      // Upload files directly to Storage in parallel (much faster than base64-through-edge-function)
      let avatarUrl: string | null = null;
      let idDocumentPath: string | null = null;

      const uploads: Promise<void>[] = [];

      if (avatarFile) {
        const ext = sanitizeExt(avatarFile.name);
        const path = `${user.id}/avatar.${ext}`;
        uploads.push(
          supabase.storage
            .from("avatars")
            .upload(path, avatarFile, { upsert: true, contentType: avatarFile.type })
            .then(({ error }) => {
              if (error) throw error;
              const { data } = supabase.storage.from("avatars").getPublicUrl(path);
              avatarUrl = `${data.publicUrl}?t=${Date.now()}`;
            })
        );
      }

      if (idFile) {
        const ext = sanitizeExt(idFile.name);
        const path = `${user.id}/id-document-${Date.now()}.${ext}`;
        uploads.push(
          supabase.storage
            .from("id-documents")
            .upload(path, idFile, { contentType: idFile.type })
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
        accepted_terms_at: string;
        avatar_url?: string;
        id_document_url?: string;
      } = {
        full_name: fullName,
        phone: phone.trim(),
        bio: bio.trim(),
        location: location.trim(),
        date_of_birth: dateOfBirth,
        approval_status: "pending",
        // Stamp the moment the user accepted the rules / terms / privacy.
        // Persisting this means the checklist won't ask again on refresh.
        accepted_terms_at: new Date().toISOString(),
      };
      if (avatarUrl) updates.avatar_url = avatarUrl;
      if (idDocumentPath) updates.id_document_url = idDocumentPath;

      const { error: updateErr } = await withTimeout(
        Promise.resolve(supabase.from("profiles").update(updates).eq("user_id", user.id)),
        "Profile save",
      );
      if (updateErr) throw updateErr;

      queryClient.setQueryData(queryKeys.currentUser.byId(user.id), (current: any) => ({
        ...(current ?? {}),
        profile: {
          ...(current?.profile ?? profile ?? {}),
          ...updates,
          user_id: user.id,
        },
        isAdmin: current?.isAdmin ?? false,
      }));
      // Force a fresh DB read so ProtectedRoute re-evaluates against the
      // *persisted* row, not just our optimistic cache. The small delay
      // gives Postgres + the realtime channel a beat to settle so the
      // very next route render reads the new values.
      await queryClient.invalidateQueries({ queryKey: queryKeys.currentUser.byId(user.id) });
      await new Promise((r) => setTimeout(r, 800));
      toast.success("Profile complete — welcome to Helpr!");
      navigate("/dashboard", { replace: true });
    } catch (err: any) {
      const recovered = await recoverCompletedProfile();
      if (!recovered) toast.error(err?.message || "Could not save your profile");
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

  if (user && !profile) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-premium-page px-5">
        <div className="w-full max-w-sm rounded-2xl border border-border/60 bg-card p-6 text-center shadow-[var(--card-shadow)]">
          <Loader2 className="mx-auto mb-4 h-6 w-6 animate-spin text-primary" />
          <h1 className="text-ds-20 font-display font-bold text-foreground">Checking your saved profile</h1>
          <p className="mt-2 text-ds-11 text-muted-foreground">
            Hang tight — we’re making sure your previous submission is loaded before asking for anything again.
          </p>
          <Button
            type="button"
            variant="outline"
            size="lg"
            onClick={async () => {
              await supabase.auth.signOut();
              navigate("/login", { replace: true });
            }}
            className="mt-5 w-full rounded-ds-md"
          >
            <X className="w-4 h-4 mr-2" /> Sign out
          </Button>
        </div>
      </div>
    );
  }

  // Don't trap users who don't actually need this gate. Legacy accounts
  // bypass entirely, and anyone whose profile already satisfies the Big 7
  // gets bounced straight to the dashboard instead of staring at a 0/8
  // checklist they can't dismiss.
  if (profile && (profile.is_legacy_user === true || isProfileComplete(profile))) {
    return <Navigate to="/dashboard" replace />;
  }

  return (
    <div className="min-h-screen bg-premium-page relative">
      <div className="relative z-10 flex items-start justify-center px-5 py-8 sm:py-12 pt-[calc(env(safe-area-inset-top)+24px)]">
        <div className="w-full max-w-md pb-12">
          <div className="text-center mb-7">
            <span className="text-display-eyebrow">Welcome aboard</span>
            <h1
              className="font-display italic font-bold leading-tight mt-2"
              style={{
                fontSize: "clamp(2rem, 4vw + 0.5rem, 2.75rem)",
                color: "hsl(var(--ink-deep))",
                letterSpacing: "-0.025em",
              }}
            >
              Almost there.
            </h1>
            <p className="mt-3 font-serif italic text-ds-13" style={{ color: "hsl(var(--olivewood) / 0.75)" }}>
              We need a few details before you can use Helpr. This keeps the community safe.
            </p>
            <p className="mt-2 text-[0.7rem] font-sans" style={{ color: "hsl(var(--olivewood) / 0.55)" }}>
              All fields marked <span style={{ color: "hsl(var(--burnt-sienna))" }}>*</span> are required.
            </p>
          </div>

          {/* Live "Big 7" checklist — green check when satisfied, red X when missing */}
          <div className="squircle mb-5 rounded-[24px] border border-border/60 bg-card/80 backdrop-blur-md shadow-[var(--card-shadow)] p-4">
            <div className="flex items-center justify-between mb-3">
              <p className="text-ds-13 font-semibold text-foreground">Verification checklist</p>
              <p className="text-ds-11 text-muted-foreground">
                {checklist.filter((c) => c.done).length}/{checklist.length}
              </p>
            </div>
            <ul className="space-y-1.5">
              {checklist.map((item) => (
                <li key={item.label} className="flex items-center gap-2.5 text-ds-13">
                  <span
                    className={cn(
                      "flex h-5 w-5 shrink-0 items-center justify-center rounded-full",
                      item.done
                        ? "bg-emerald-500/15 text-emerald-600"
                        : "bg-destructive/10 text-destructive",
                    )}
                    aria-hidden
                  >
                    {item.done ? <Check className="h-3.5 w-3.5" /> : <X className="h-3.5 w-3.5" />}
                  </span>
                  <span className={cn(item.done ? "text-muted-foreground line-through" : "text-foreground")}>
                    {item.label}
                  </span>
                </li>
              ))}
            </ul>
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
                  {avatarPreview && avatarPreview.startsWith("blob:") ? (
                    <img loading="lazy" decoding="async" src={avatarPreview} alt="Profile preview" className="w-full h-full object-cover" />
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
              <p className="text-ds-11 text-muted-foreground">
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
                  className="rounded-ds-md"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="lastName">Last name <span className="text-destructive">*</span></Label>
                <Input
                  id="lastName"
                  autoComplete="family-name"
                  value={lastName}
                  onChange={(e) => setLastName(e.target.value)}
                  className="rounded-ds-md"
                />
              </div>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="dob">Date of birth (must be 18+) <span className="text-destructive">*</span></Label>
              <DateOfBirthPicker id="dob" value={dateOfBirth} onChange={setDateOfBirth} />
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
                className="rounded-ds-md"
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
                className="rounded-ds-md"
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
                className="rounded-ds-md"
              />
            </div>

            {/* ID */}
            <div className="space-y-1.5">
              {/* htmlFor pairs the visible heading with the file input the
                  wrapping <label> opens, so screen readers announce
                  "Government-issued ID, file" instead of an unlabeled input. */}
              <Label htmlFor="id-doc">Government-issued ID <span className="text-destructive">*</span></Label>
              <label
                htmlFor="id-doc"
                className="flex items-center gap-3 rounded-ds-md border border-dashed border-border p-3 cursor-pointer hover:bg-muted/40"
              >
                {idPreview && idPreview.startsWith("blob:") ? (
                  <img loading="lazy" decoding="async" src={idPreview} alt="ID preview" className="w-14 h-14 rounded-md object-cover" />
                ) : (
                  <div className="w-14 h-14 rounded-md bg-muted flex items-center justify-center">
                    <FileText className="w-5 h-5 text-muted-foreground" />
                  </div>
                )}
                <div className="text-ds-13">
                  <div className="font-medium">
                    {idFile ? idFile.name : profile?.id_document_url ? "Replace ID" : "Upload your ID"}
                  </div>
                  <div className="text-muted-foreground text-ds-11">Image or PDF. Max 5MB.</div>
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

            <label className="flex items-start gap-2.5 text-ds-11 cursor-pointer" style={{ color: "hsl(var(--olivewood) / 0.75)" }}>
              <Checkbox
                checked={acceptedPolicies}
                onCheckedChange={(v) => setAcceptedPolicies(v === true)}
                className="h-3.5 w-3.5 mt-[3px] shrink-0 [&_svg]:h-3 [&_svg]:w-3"
              />
              <span className="leading-relaxed">
                I agree to the{" "}
                <a href="/rules" target="_blank" rel="noreferrer" className="font-semibold hover:underline" style={{ color: "hsl(var(--bark))" }}>platform rules</a>,{" "}
                <a href="/terms" target="_blank" rel="noreferrer" className="font-semibold hover:underline" style={{ color: "hsl(var(--bark))" }}>terms</a>, and{" "}
                <a href="/privacy" target="_blank" rel="noreferrer" className="font-semibold hover:underline" style={{ color: "hsl(var(--bark))" }}>privacy policy</a>. <span style={{ color: "hsl(var(--burnt-sienna))" }}>*</span>
              </span>
            </label>

            <Button
              type="submit"
              size="lg"
              className="w-full rounded-ds-md"
              disabled={submitting || !allComplete}
              style={
                allComplete && !submitting
                  ? {
                      background: "hsl(var(--bark))",
                      backgroundImage: "none",
                      border: "1px solid hsl(var(--bark))",
                      color: "hsl(var(--parchment))",
                      fontFamily: "Montserrat, system-ui, sans-serif",
                      fontWeight: 600,
                      letterSpacing: "0.01em",
                      boxShadow:
                        "0 1px 2px rgba(0,0,0,0.04), 0 12px 32px -8px hsl(var(--bark) / 0.5)",
                    }
                  : undefined
              }
            >
              {submitting ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <ShieldCheck className="w-4 h-4 mr-2" />}
              {submitting ? "Saving…" : allComplete ? "Enter app" : "Complete all items above"}
            </Button>

            <Button
              type="button"
              variant="outline"
              size="lg"
              onClick={async () => {
                await supabase.auth.signOut();
                navigate("/login", { replace: true });
              }}
              className="w-full rounded-ds-md"
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
