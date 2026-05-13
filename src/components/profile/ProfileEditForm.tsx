import { useRef, useState } from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Shield, Upload, Loader2, Camera, ImagePlus, X } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import type { Database } from "@/integrations/supabase/types";
import ProfileTabHeader from "@/components/profile/ProfileTabHeader";

type Profile = Database["public"]["Tables"]["profiles"]["Row"];

interface ProfileEditFormProps {
  profile: Profile | null;
  firstName: string;
  lastName: string;
  phone: string;
  setPhone: (v: string) => void;
  location: string;
  setLocation: (v: string) => void;
  zipCode: string;
  setZipCode: (v: string) => void;
  bio: string;
  setBio: (v: string) => void;
  initials: string;
  avatarBroken: boolean;
  setAvatarBroken: (v: boolean) => void;
  avatarUploading: boolean;
  idUploading: boolean;
  saving: boolean;
  justSaved: boolean;
  onSave: (e: React.FormEvent) => void;
  onAvatarUpload: (e: React.ChangeEvent<HTMLInputElement>) => void;
  onIdUpload: (e: React.ChangeEvent<HTMLInputElement>) => void;
  onBack: () => void;
  /** Called after portfolio upload/remove with the full new URL list so
   *  the parent can sync its profile state without a refetch. */
  onPortfolioChange?: (urls: string[]) => void;
}

export function ProfileEditForm({
  profile,
  firstName,
  lastName,
  phone,
  setPhone,
  location,
  setLocation,
  zipCode,
  setZipCode,
  bio,
  setBio,
  initials,
  avatarBroken,
  setAvatarBroken,
  avatarUploading,
  idUploading,
  saving,
  justSaved,
  onSave,
  onAvatarUpload,
  onIdUpload,
  onBack,
  onPortfolioChange,
}: ProfileEditFormProps) {
  const idStatus = (profile as any)?.idv_status as string | null;
  const hasId = !!(profile as any)?.id_document_url;
  const idBadge = idStatus === "verified"
    ? { label: "Verified", cls: "bg-green-500/10 text-green-600 dark:text-green-500" }
    : (idStatus === "pending" || idStatus === "processing" || idStatus === "manual_review" || (hasId && !idStatus))
    ? { label: "Pending review", cls: "bg-amber-500/10 text-amber-600 dark:text-amber-500" }
    : idStatus === "failed"
    ? { label: "Action needed", cls: "bg-destructive/10 text-destructive" }
    : { label: "Not uploaded", cls: "bg-muted text-muted-foreground" };
  const bioOk = bio.trim().length >= 20;

  // ─── Work portfolio (profiles.portfolio_urls) ──────────────────────
  // Helpers upload up to 6 photos of previous work; applicants see these
  // on the public profile when deciding whether to apply. Uses the same
  // `avatars` public bucket as the profile photo (path-scoped to user).
  const portfolioUrls: string[] = (profile as any)?.portfolio_urls ?? [];
  const MAX_PORTFOLIO = 6;
  const [portfolioUploading, setPortfolioUploading] = useState(false);
  const portfolioInputRef = useRef<HTMLInputElement>(null);

  const persistPortfolio = async (next: string[]) => {
    const userId = (profile as any)?.user_id;
    if (!userId) return;
    const { error } = await supabase
      .from("profiles")
      .update({ portfolio_urls: next } as any)
      .eq("user_id", userId);
    if (error) {
      toast.error("Couldn't save your work photos");
      return;
    }
    onPortfolioChange?.(next);
  };

  const handlePortfolioPick = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    e.target.value = "";
    if (!files.length) return;
    const userId = (profile as any)?.user_id;
    if (!userId) return;

    const slotsLeft = MAX_PORTFOLIO - portfolioUrls.length;
    if (slotsLeft <= 0) {
      toast.error(`Maximum ${MAX_PORTFOLIO} photos`);
      return;
    }
    const usable = files.slice(0, slotsLeft).filter((f) => {
      if (!f.type.startsWith("image/")) {
        toast.error(`Skipping ${f.name} (not an image)`);
        return false;
      }
      if (f.size > 5 * 1024 * 1024) {
        toast.error(`Skipping ${f.name} (over 5MB)`);
        return false;
      }
      return true;
    });
    if (!usable.length) return;

    setPortfolioUploading(true);
    const uploaded: string[] = [];
    for (const file of usable) {
      const ext = (file.name.split(".").pop() || "jpg").toLowerCase();
      const path = `${userId}/portfolio/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
      const { error } = await supabase.storage
        .from("avatars")
        .upload(path, file, { upsert: false, contentType: file.type });
      if (error) {
        toast.error(`Couldn't upload ${file.name}`);
        continue;
      }
      const { data: urlData } = supabase.storage.from("avatars").getPublicUrl(path);
      uploaded.push(urlData.publicUrl);
    }
    setPortfolioUploading(false);
    if (!uploaded.length) return;
    await persistPortfolio([...portfolioUrls, ...uploaded]);
    toast.success(`Added ${uploaded.length} ${uploaded.length === 1 ? "photo" : "photos"} to your work`);
  };

  const removePortfolioAt = async (i: number) => {
    const next = portfolioUrls.filter((_, idx) => idx !== i);
    await persistPortfolio(next);
  };

  // ─── Profile completion meter ──────────────────────────────────────
  // Counts the 6 things that meaningfully populate the applicant-facing
  // card. Re-rendered as the user fills them out.
  const completionItems = [
    { label: "Profile photo", done: !!profile?.avatar_url },
    { label: "Phone", done: !!phone.trim() },
    { label: "Location", done: !!location.trim() && !!zipCode.trim() },
    { label: "Bio", done: bioOk },
    { label: "ID verified", done: idStatus === "verified" || idStatus === "pending" || idStatus === "processing" || idStatus === "manual_review" },
    { label: "Work photos", done: portfolioUrls.length > 0 },
  ];
  const completionDone = completionItems.filter((i) => i.done).length;
  const completionPct = Math.round((completionDone / completionItems.length) * 100);

  return (
    // Bottom padding clears the new sticky save bar (16+44+16 = 76px) plus
    // a safe-area buffer so the last form field doesn't tuck under the bar.
    <div className="space-y-3" style={{ paddingBottom: "calc(env(safe-area-inset-bottom, 0px) + 6.5rem)" }}>
      <ProfileTabHeader
        eyebrow="Identity"
        title="Edit profile"
        meta="Photo, contact, and verification"
        onBack={onBack}
      />

      {/* Completion meter — shows the user exactly what's left to make the
          profile applicant-ready. 6 items: photo / phone / location / bio
          / ID / work photos. Tints based on progress. */}
      <div className="rounded-2xl liquid-glass p-4 space-y-2">
        <div className="flex items-center justify-between">
          <p className="font-serif italic uppercase text-ds-9" style={{ color: "hsl(var(--burnt-sienna) / 0.78)", letterSpacing: "0.18em" }}>
            Profile completion
          </p>
          <span
            className="font-display italic font-bold tabular-nums"
            style={{
              fontSize: "0.95rem",
              color: completionPct === 100 ? "hsl(var(--bark))" : "hsl(var(--ink-deep))",
              letterSpacing: "-0.01em",
            }}
          >
            {completionPct}%
          </span>
        </div>
        <div className="h-2 w-full rounded-full bg-muted/60 overflow-hidden">
          <div
            className="h-full rounded-full transition-all duration-500"
            style={{
              width: `${completionPct}%`,
              background:
                completionPct === 100
                  ? "hsl(var(--bark))"
                  : completionPct >= 66
                    ? "hsl(var(--bark) / 0.85)"
                    : "hsl(var(--burnt-sienna) / 0.75)",
            }}
          />
        </div>
        {completionPct < 100 && (
          <p className="font-serif italic text-ds-11 leading-snug" style={{ color: "hsl(var(--olivewood) / 0.7)" }}>
            Next:{" "}
            <span className="font-semibold" style={{ color: "hsl(var(--ink-deep))" }}>
              {completionItems.find((i) => !i.done)?.label}
            </span>
            {" — "}
            complete profiles get more offers.
          </p>
        )}
      </div>

      <form onSubmit={onSave} className="space-y-4">
        {/* Photo + Name section */}
        <div className="rounded-2xl liquid-glass p-5 space-y-4">
          <p className="font-serif italic uppercase" style={{ fontSize: "0.6rem", color: "hsl(var(--burnt-sienna) / 0.78)", letterSpacing: "0.18em" }}>
            Photo &amp; name
          </p>
          <div className="flex items-center gap-4">
            {/* Avatar always shows the actual photo (previously hidden behind
                a full-coverage Camera overlay at opacity-100 on mobile).
                Upload trigger moved to a small floating chip at the bottom-
                right of the avatar so the user always sees their photo. */}
            <div className="relative shrink-0">
              {profile?.avatar_url && !avatarBroken ? (
                <img
                  loading="lazy"
                  decoding="async"
                  src={profile.avatar_url}
                  alt=""
                  className="w-20 h-20 rounded-full object-cover border-2 border-primary/20"
                  onError={() => setAvatarBroken(true)}
                />
              ) : (
                <div className="w-20 h-20 rounded-full bg-primary/10 text-primary flex items-center justify-center text-ds-24 font-display italic font-bold border-2 border-primary/20">
                  {initials}
                </div>
              )}
              <label
                className="absolute -bottom-1 -right-1 w-8 h-8 rounded-full flex items-center justify-center cursor-pointer active:scale-95 transition-transform"
                style={{
                  background: "hsl(var(--bark))",
                  border: "2px solid hsl(var(--parchment))",
                  boxShadow:
                    "0 1px 2px hsl(70 20% 18% / 0.22), " +
                    "0 4px 10px -2px hsl(var(--bark) / 0.4)",
                }}
                aria-label="Change profile photo"
              >
                {avatarUploading ? (
                  <Loader2 className="w-4 h-4 animate-spin" style={{ color: "hsl(var(--parchment))" }} />
                ) : (
                  <Camera className="w-4 h-4" style={{ color: "hsl(var(--parchment))" }} />
                )}
                <input type="file" accept="image/*" className="hidden" onChange={onAvatarUpload} disabled={avatarUploading} />
              </label>
            </div>
            <div className="min-w-0 flex-1">
              <p className="font-display italic font-bold leading-tight truncate" style={{ fontSize: "1.15rem", color: "hsl(var(--ink-deep))", letterSpacing: "-0.015em" }}>
                {`${firstName} ${lastName}`.trim() || "Your name"}
              </p>
              <p className="font-serif italic mt-1 leading-snug" style={{ fontSize: "0.78rem", color: "hsl(var(--olivewood) / 0.7)" }}>
                Tap the photo to change. Your name is locked after signup.
              </p>
            </div>
          </div>
        </div>

        {/* Contact section */}
        <div className="rounded-2xl liquid-glass p-5 space-y-4">
          <p className="font-serif italic uppercase" style={{ fontSize: "0.6rem", color: "hsl(var(--burnt-sienna) / 0.78)", letterSpacing: "0.18em" }}>
            Contact
          </p>
          <div className="space-y-3">
            <div>
              <Label htmlFor="phone" className="text-ds-11 mb-1.5 block">Phone</Label>
              <Input id="phone" type="tel" autoComplete="tel" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="555 123 4567" className="h-10" />
            </div>
            <div className="grid grid-cols-3 gap-3">
              <div className="col-span-2">
                <Label htmlFor="location" className="text-ds-11 mb-1.5 block">City</Label>
                <Input id="location" autoComplete="address-level2" value={location} onChange={(e) => setLocation(e.target.value)} placeholder="Baton Rouge" className="h-10" />
              </div>
              <div>
                <Label htmlFor="zipCode" className="text-ds-11 mb-1.5 block">ZIP</Label>
                <Input
                  id="zipCode"
                  value={zipCode}
                  onChange={(e) => setZipCode(e.target.value.replace(/\D/g, "").slice(0, 5))}
                  placeholder="70801"
                  inputMode="numeric"
                  autoComplete="postal-code"
                  maxLength={5}
                  className="h-10"
                />
              </div>
            </div>
          </div>
        </div>

        {/* Bio section */}
        <div className="rounded-2xl liquid-glass p-5 space-y-3">
          <div className="flex items-center justify-between">
            <p className="font-serif italic uppercase" style={{ fontSize: "0.6rem", color: "hsl(var(--burnt-sienna) / 0.78)", letterSpacing: "0.18em" }}>
              About your work
            </p>
            <span className={`text-ds-11 font-medium ${bioOk ? "text-green-600 dark:text-green-500" : "text-muted-foreground"}`}>{bio.trim().length}/20</span>
          </div>
          <Textarea
            id="bio"
            value={bio}
            onChange={(e) => setBio(e.target.value)}
            placeholder="What you do, tools you bring, what makes you reliable…"
            className="min-h-[112px] resize-none text-ds-13 leading-relaxed"
          />
          <p className="font-serif italic leading-snug" style={{ fontSize: "0.74rem", color: "hsl(var(--olivewood) / 0.7)" }}>
            Customers read this when deciding who to hire. The more specific, the better.
          </p>
        </div>

        {/* ID Verification section */}
        <div className="rounded-2xl liquid-glass p-5 space-y-4">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
              <Shield className="w-4 h-4 text-primary" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="font-serif italic uppercase" style={{ fontSize: "0.6rem", color: "hsl(var(--burnt-sienna) / 0.78)", letterSpacing: "0.18em" }}>
                Trust
              </p>
              <h2 className="font-display italic font-bold leading-tight flex items-center gap-2 flex-wrap" style={{ fontSize: "1.05rem", color: "hsl(var(--ink-deep))", letterSpacing: "-0.015em" }}>
                ID verification
                <span className={`text-[9px] px-1.5 py-0.5 rounded-full font-medium not-italic ${idBadge.cls}`}>{idBadge.label}</span>
              </h2>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <p className="font-serif italic leading-snug flex-1" style={{ fontSize: "0.78rem", color: "hsl(var(--olivewood) / 0.7)" }}>
              Upload a government-issued ID. Encrypted in transit and reviewed by Helpr.
            </p>
            <label className="shrink-0">
              <span className="inline-flex items-center gap-1.5 text-ds-11 font-semibold px-3 h-9 rounded-ds-md bg-primary text-primary-foreground cursor-pointer hover:bg-primary/90 active:scale-[0.98] transition-all">
                {idUploading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Upload className="w-3.5 h-3.5" />}
                {hasId ? "Replace" : "Upload"}
              </span>
              <input
                type="file"
                accept="image/jpeg,image/png,image/webp,application/pdf"
                className="hidden"
                onChange={onIdUpload}
                disabled={idUploading}
              />
            </label>
          </div>
        </div>

        {/* Work portfolio — photos of previous work shown on the public
            profile when applicants are deciding who to hire. Up to 6 images,
            5MB each, JPG/PNG/WEBP. Uses the public `avatars` bucket path-
            scoped to the user's id. The user explicitly asked for this in
            their Edit-profile screenshot review. */}
        <div className="rounded-2xl liquid-glass p-5 space-y-4">
          <div className="flex items-center justify-between gap-2">
            <p className="font-serif italic uppercase" style={{ fontSize: "0.6rem", color: "hsl(var(--burnt-sienna) / 0.78)", letterSpacing: "0.18em" }}>
              Recent work
            </p>
            <span className="text-ds-11 text-muted-foreground">{portfolioUrls.length}/{MAX_PORTFOLIO}</span>
          </div>
          <p className="font-serif italic leading-snug -mt-1" style={{ fontSize: "0.78rem", color: "hsl(var(--olivewood) / 0.7)" }}>
            Show off recent jobs — applicants see these when deciding to apply.
          </p>
          <div className="grid grid-cols-3 gap-2">
            {portfolioUrls.map((url, i) => (
              <div key={url} className="relative aspect-square rounded-xl overflow-hidden border border-border/60 group">
                <img
                  loading="lazy"
                  decoding="async"
                  src={url}
                  alt={`Work sample ${i + 1}`}
                  className="w-full h-full object-cover"
                />
                <button
                  type="button"
                  onClick={() => removePortfolioAt(i)}
                  aria-label="Remove this photo"
                  className="absolute top-1 right-1 w-7 h-7 rounded-full flex items-center justify-center active:scale-90 transition-transform"
                  style={{
                    background: "hsla(0, 0%, 0%, 0.55)",
                    backdropFilter: "blur(6px)",
                    WebkitBackdropFilter: "blur(6px)",
                  }}
                >
                  <X className="w-3.5 h-3.5 text-white" />
                </button>
              </div>
            ))}
            {portfolioUrls.length < MAX_PORTFOLIO && (
              <button
                type="button"
                onClick={() => portfolioInputRef.current?.click()}
                disabled={portfolioUploading}
                className="aspect-square rounded-xl border-2 border-dashed border-border/60 hover:border-primary/40 flex flex-col items-center justify-center gap-1 text-muted-foreground hover:text-primary active:scale-[0.98] transition-all"
              >
                {portfolioUploading ? (
                  <Loader2 className="w-5 h-5 animate-spin" />
                ) : (
                  <>
                    <ImagePlus className="w-5 h-5" />
                    <span className="text-ds-10 font-sans font-medium">Add photo</span>
                  </>
                )}
              </button>
            )}
          </div>
          <input
            ref={portfolioInputRef}
            type="file"
            accept="image/jpeg,image/png,image/webp"
            multiple
            className="hidden"
            onChange={handlePortfolioPick}
            disabled={portfolioUploading}
          />
        </div>
      </form>

      {/* Sticky save bar — keeps the primary action one-tap-away whether
          the user is at the top of the form or scrolled to the ID upload
          section at the bottom. Frosted glass surface so content behind
          softly blurs through. */}
      <div
        className="fixed bottom-0 left-0 right-0 z-40 px-4 pt-3 pb-2 pointer-events-none"
        style={{ paddingBottom: "calc(env(safe-area-inset-bottom, 0px) + 0.5rem)" }}
      >
        <div
          className="pointer-events-auto max-w-2xl mx-auto rounded-2xl flex items-center gap-2 p-2"
          style={{
            background: "hsla(38, 18%, 97%, 0.85)",
            backdropFilter: "blur(24px) saturate(170%)",
            WebkitBackdropFilter: "blur(24px) saturate(170%)",
            border: "1px solid hsla(0, 0%, 100%, 0.6)",
            boxShadow:
              "inset 0 1px 1px 0 rgba(255, 255, 255, 0.4), " +
              "0 -8px 22px -10px hsl(var(--olivewood) / 0.18), " +
              "0 1px 2px hsl(var(--olivewood) / 0.06), " +
              "0 14px 30px -8px hsl(var(--olivewood) / 0.18)",
          }}
        >
          <button
            type="button"
            onClick={onBack}
            className="flex-1 h-11 rounded-ds-md inline-flex items-center justify-center text-ds-13 font-semibold text-foreground hover:bg-secondary/40 active:scale-[0.98] transition-all"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={(e) => onSave(e as unknown as React.FormEvent)}
            disabled={saving || justSaved}
            className="flex-[2] h-11 rounded-ds-md inline-flex items-center justify-center gap-2 text-ds-13 font-bold transition-all active:scale-[0.98] disabled:active:scale-100"
            style={{
              background: saving ? "hsl(var(--muted))" : "hsl(var(--bark))",
              color: saving ? "hsl(var(--muted-foreground))" : "hsl(var(--parchment))",
              border: "1px solid hsl(70 22% 24%)",
              boxShadow:
                "inset 0 1px 0 0 rgba(255, 255, 255, 0.12), " +
                "0 1px 2px hsl(70 20% 18% / 0.18), " +
                "0 6px 14px -4px hsl(var(--bark) / 0.4)",
              cursor: saving ? "not-allowed" : "pointer",
            }}
          >
            {saving ? (<><Loader2 className="w-4 h-4 animate-spin" /> Saving…</>) : justSaved ? "✓ Saved" : "Save changes"}
          </button>
        </div>
      </div>
    </div>
  );
}

export default ProfileEditForm;
