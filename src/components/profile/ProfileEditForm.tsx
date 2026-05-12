import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Shield, Upload, Loader2, Camera } from "lucide-react";
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

  return (
    <div className="space-y-5 pb-24">
      <ProfileTabHeader
        eyebrow="Identity"
        title="Edit profile"
        meta="Photo, contact, and verification"
        onBack={onBack}
      />

      <form onSubmit={onSave} className="space-y-4">
        {/* Photo + Name section */}
        <div className="rounded-2xl liquid-glass p-5 space-y-4">
          <p className="font-serif italic uppercase" style={{ fontSize: "0.6rem", color: "hsl(var(--burnt-sienna) / 0.78)", letterSpacing: "0.18em" }}>
            Photo &amp; name
          </p>
          <div className="flex items-center gap-4">
            <div className="relative group shrink-0">
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
              <label className="absolute inset-0 flex items-center justify-center rounded-full bg-black/40 opacity-100 sm:opacity-0 group-hover:opacity-100 transition-opacity cursor-pointer">
                {avatarUploading ? <Loader2 className="w-5 h-5 text-white animate-spin" /> : <Camera className="w-5 h-5 text-white" />}
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

        {/* Save / Cancel actions */}
        <div className="grid grid-cols-3 gap-3 pt-2">
          <button
            type="button"
            onClick={onBack}
            className="rounded-2xl liquid-glass h-12 inline-flex items-center justify-center gap-2 text-ds-13 font-semibold text-foreground hover:bg-secondary/40 active:scale-[0.98] transition-all"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={saving || justSaved}
            className={`col-span-2 rounded-2xl h-12 inline-flex items-center justify-center gap-2 text-ds-13 font-bold transition-all active:scale-[0.98] disabled:active:scale-100 shadow-[0_2px_4px_hsl(var(--primary)/0.15),0_12px_32px_-12px_hsl(var(--primary)/0.45)] ${
              saving
                ? "bg-muted text-muted-foreground cursor-not-allowed"
                : justSaved
                ? "bg-primary text-primary-foreground"
                : "bg-primary hover:bg-primary/90 text-primary-foreground"
            }`}
          >
            {saving ? (<><Loader2 className="w-4 h-4 animate-spin" /> Saving…</>) : justSaved ? "✓ Saved" : "Save changes"}
          </button>
        </div>
      </form>
    </div>
  );
}

export default ProfileEditForm;
