import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { useKeyboardInset } from "@/hooks/useKeyboardInset";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Upload, Loader2, Check, MapPin, Eye } from "lucide-react";
import { getProfileCompletion } from "@/lib/profileCompletion";
import { lookupParishByZip } from "@/lib/parishLookup";
import ProfileTabHeader from "@/components/profile/ProfileTabHeader";
import type { ProfileEditFormProps } from "@/components/profile/profileEditForm/types";
import { usePortfolio } from "@/components/profile/profileEditForm/usePortfolio";
import { PhotoNameSection } from "@/components/profile/profileEditForm/PhotoNameSection";
import { RecentWorkSection } from "@/components/profile/profileEditForm/RecentWorkSection";
import { SaveBar } from "@/components/profile/profileEditForm/SaveBar";

export type { ProfileEditFormProps } from "@/components/profile/profileEditForm/types";

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
  onContactSupport,
}: ProfileEditFormProps) {
  const idStatus = profile?.idv_status ?? null;
  const hasId = !!profile?.id_document_url;
  const idBadge = idStatus === "verified"
    ? { label: "Verified", cls: "bg-success/10 text-success" }
    : (idStatus === "pending" || idStatus === "processing" || idStatus === "manual_review" || (hasId && !idStatus))
    ? { label: "Pending review", cls: "bg-warning/10 text-warning" }
    : idStatus === "failed"
    ? { label: "Action needed", cls: "bg-destructive/10 text-destructive" }
    : { label: "Not uploaded", cls: "bg-muted text-muted-foreground" };
  const bioOk = bio.trim().length >= 20;
  const phoneValid = phone.replace(/\D/g, "").length >= 10;
  const locationValid = location.trim().length > 0;

  // Dirty check — the Save bar drives only the text fields (avatar /
  // ID / portfolio persist on their own). Disabled when nothing in
  // this set has diverged from the saved profile.
  const dirty =
    phone !== (profile?.phone ?? "") ||
    location !== (profile?.location ?? "") ||
    zipCode !== (profile?.zip_code ?? "") ||
    bio !== (profile?.bio ?? "");

  // Resolve parish from ZIP for an inline confirmation under the field
  // (it's the value used for Louisiana sales tax). Mirrors the silent
  // lookup the Profile page already runs.
  const [resolvedParish, setResolvedParish] = useState<string | null>(
    (profile?.parish ?? null),
  );
  useEffect(() => {
    const cleaned = zipCode.replace(/\D/g, "");
    if (cleaned.length !== 5) {
      setResolvedParish(null);
      return;
    }
    let cancelled = false;
    lookupParishByZip(cleaned).then((p) => { if (!cancelled) setResolvedParish(p); });
    return () => { cancelled = true; };
  }, [zipCode]);

  // iOS hides the bio textarea (and the ID/portfolio controls below it)
  // behind the keyboard when focused, since they sit low in this scrollable
  // form. When the keyboard rises, scroll the focused control into view —
  // same useKeyboardInset pattern Messages uses to lift its composer.
  const keyboardInset = useKeyboardInset();
  useEffect(() => {
    if (keyboardInset <= 0) return;
    const el = document.activeElement;
    if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) {
      // Defer a frame so layout settles to the keyboard-inset viewport first.
      requestAnimationFrame(() => {
        el.scrollIntoView({ behavior: "smooth", block: "center" });
      });
    }
  }, [keyboardInset]);

  // ─── Work portfolio (profiles.portfolio_urls) ──────────────────────
  const {
    portfolioUrls,
    portfolioUploading,
    portfolioInputRef,
    handlePortfolioPick,
    removePortfolioAt,
  } = usePortfolio({ profile, onPortfolioChange });

  // ─── Profile completion meter ──────────────────────────────────────
  // Shared getProfileCompletion helper. The checklist tracks only the
  // post-signup enhancements (ZIP / ID / work photos), but the percentage
  // also counts the core signup fields so a finished profile never reads
  // as 0%. Core flags use the live form values where this form edits them
  // (bio / phone / city) and the saved row otherwise (name / avatar / DOB
  // / ID doc persist outside the text-field save bar).
  const coreComplete = [
    !!profile?.full_name?.trim(),
    !!profile?.avatar_url,
    bioOk,
    !!profile?.date_of_birth,
    !!phone.trim(),
    !!location.trim(),
    !!profile?.id_document_url,
  ];
  const completion = getProfileCompletion({
    zipCode,
    idvStatus: idStatus,
    portfolioCount: portfolioUrls.length,
    core: coreComplete,
  });
  const completionPct = completion.pct;

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

      <form onSubmit={onSave} className="space-y-4">
        {/* Photo + Name section */}
        <PhotoNameSection
          profile={profile}
          firstName={firstName}
          lastName={lastName}
          initials={initials}
          avatarBroken={avatarBroken}
          setAvatarBroken={setAvatarBroken}
          avatarUploading={avatarUploading}
          onAvatarUpload={onAvatarUpload}
          onContactSupport={onContactSupport}
        />

        {/* Completion meter — the 3 post-signup enhancements (ZIP / ID
            verified / work photos) via the shared getProfileCompletion
            helper. Tints based on progress. Sits just under Photo & Name
            so the headline identity row leads and the progress nudge
            follows it. */}
        <div className="rounded-2xl liquid-glass p-5 space-y-2">
          <div className="flex items-center justify-between">
            <p className="font-serif italic uppercase text-ds-9" style={{ color: "hsl(var(--burnt-sienna))", letterSpacing: "0.18em" }}>
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
          {completion.nextLabel && (
            <p className="font-serif italic text-ds-11 leading-snug" style={{ color: "hsl(var(--olivewood) / 0.8)" }}>
              Next:{" "}
              <span className="font-semibold" style={{ color: "hsl(var(--ink-deep))" }}>
                {completion.nextLabel}
              </span>
              {" — "}
              complete profiles get more offers.
            </p>
          )}
        </div>

        {/* Contact section */}
        <div className="rounded-2xl liquid-glass p-5 space-y-4">
          <p className="font-serif italic uppercase" style={{ fontSize: "0.6rem", color: "hsl(var(--burnt-sienna))", letterSpacing: "0.18em" }}>
            Contact
          </p>
          <div className="space-y-3">
            <div>
              <Label htmlFor="phone" className="text-ds-11 mb-1.5 block">Phone</Label>
              <div className="relative">
                <Input id="phone" type="tel" inputMode="tel" autoComplete="tel" enterKeyHint="next" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="555 123 4567" className={`h-10 ${phoneValid ? "pr-10" : ""}`} />
                {phoneValid && (
                  <Check className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-primary pointer-events-none" strokeWidth={2.5} aria-hidden />
                )}
              </div>
            </div>
            <div className="grid grid-cols-3 gap-3">
              <div className="col-span-2">
                <Label htmlFor="location" className="text-ds-11 mb-1.5 block">City</Label>
                <div className="relative">
                  <Input id="location" autoComplete="address-level2" autoCapitalize="words" enterKeyHint="next" value={location} onChange={(e) => setLocation(e.target.value)} placeholder="Baton Rouge" className={`h-10 ${locationValid ? "pr-10" : ""}`} />
                  {locationValid && (
                    <Check className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-primary pointer-events-none" strokeWidth={2.5} aria-hidden />
                  )}
                </div>
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
            {/* Parish confirmation — reassures the user the ZIP
                registered (and catches a wrong one). Parish drives
                Louisiana sales tax. */}
            {resolvedParish && (
              <p className="flex items-center gap-1 text-ds-11" style={{ color: "hsl(var(--olivewood) / 0.8)" }}>
                <MapPin className="w-3 h-3 shrink-0" />
                Parish · <span className="font-semibold" style={{ color: "hsl(var(--ink-deep))" }}>{resolvedParish}</span>
              </p>
            )}
          </div>
        </div>

        {/* Bio section */}
        <div className="rounded-2xl liquid-glass p-5 space-y-3">
          <div className="flex items-center justify-between">
            <p className="font-serif italic uppercase" style={{ fontSize: "0.6rem", color: "hsl(var(--burnt-sienna))", letterSpacing: "0.18em" }}>
              About you
            </p>
            {/* "20" is a MINIMUM, not a cap — showing "108/20" once the
                user is past it reads like an over-limit error. So:
                "X/20" while short of the minimum, a check once met. */}
            {bioOk ? (
              <span className="text-ds-11 font-medium text-success inline-flex items-center gap-1">
                <Check className="w-3 h-3" strokeWidth={3} /> Looks good
              </span>
            ) : (
              <span className="text-ds-11 font-medium text-muted-foreground tabular-nums">
                {bio.trim().length}/20 min
              </span>
            )}
          </div>
          <Textarea
            id="bio"
            value={bio}
            onChange={(e) => setBio(e.target.value)}
            placeholder="What you do, tools you bring, what makes you reliable…"
            autoCapitalize="sentences"
            className="min-h-[112px] resize-none text-ds-13 leading-relaxed"
          />
          <p className="font-serif italic leading-snug" style={{ fontSize: "0.74rem", color: "hsl(var(--olivewood) / 0.8)" }}>
            Customers read this when deciding who to hire. The more specific, the better.
          </p>
        </div>

        {/* ID Verification section — header simplified to the same
            eyebrow-only pattern the other sections use (it used to
            carry an icon circle + separate title, which read as a
            different design). Status badge sits on the right. */}
        <div className="rounded-2xl liquid-glass p-5 space-y-4">
          <div className="flex items-center justify-between gap-2">
            <p className="font-serif italic uppercase" style={{ fontSize: "0.6rem", color: "hsl(var(--burnt-sienna))", letterSpacing: "0.18em" }}>
              ID verification
            </p>
            <span className={`text-[9px] px-1.5 py-0.5 rounded-full font-medium not-italic ${idBadge.cls}`}>{idBadge.label}</span>
          </div>
          <div className="flex items-center gap-3">
            <p className="font-serif italic leading-snug flex-1" style={{ fontSize: "0.78rem", color: "hsl(var(--olivewood) / 0.8)" }}>
              Upload a government-issued ID. Encrypted in transit, used only for identity verification and fraud prevention.
            </p>
            <label className="shrink-0">
              <span
                className={`inline-flex items-center gap-1.5 text-ds-11 font-semibold px-3 h-9 rounded-ds-md cursor-pointer active:scale-[0.98] transition-all ${
                  hasId
                    ? "bg-primary/10 text-primary border border-primary/30 hover:bg-primary/20"
                    : "bg-primary text-primary-foreground hover:bg-primary/90"
                }`}
              >
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
        <RecentWorkSection
          portfolioUrls={portfolioUrls}
          portfolioUploading={portfolioUploading}
          portfolioInputRef={portfolioInputRef}
          handlePortfolioPick={handlePortfolioPick}
          removePortfolioAt={removePortfolioAt}
        />

        {/* Preview + autosave reassurance — closes the gap below the last
            card and lets the user see their public profile exactly as
            applicants do, then clarifies the save model so the sticky
            bar's "Save changes" doesn't read as "nothing saved yet". */}
        {profile?.user_id && (
          <Link
            to={`/user/${profile.user_id}`}
            className="rounded-2xl liquid-glass p-4 flex items-center justify-center gap-2 text-ds-13 font-semibold active:scale-[0.98] transition-all"
            style={{ color: "hsl(var(--bark))" }}
          >
            <Eye className="w-4 h-4" strokeWidth={2} aria-hidden />
            Preview my public profile
          </Link>
        )}
        <p
          className="text-center font-serif italic px-6 leading-snug"
          style={{ fontSize: "0.72rem", color: "hsl(var(--olivewood) / 0.8)" }}
        >
          Photos &amp; ID save automatically. Your other edits save from the{" "}
          <span className="not-italic font-sans font-medium">bar below</span>.
        </p>
      </form>

      {/* Sticky save bar — keeps the primary action one-tap-away whether
          the user is at the top of the form or scrolled to the ID upload
          section at the bottom. Frosted glass surface so content behind
          softly blurs through. */}
      <SaveBar
        dirty={dirty}
        saving={saving}
        justSaved={justSaved}
        onBack={onBack}
        onSave={onSave}
      />
    </div>
  );
}

export default ProfileEditForm;
