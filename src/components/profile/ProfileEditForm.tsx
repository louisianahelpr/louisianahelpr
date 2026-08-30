import { useEffect, useState } from "react";
import { useKeyboardInset } from "@/hooks/useKeyboardInset";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Upload, Loader2, Check, MapPin } from "lucide-react";
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
  skills,
  setSkills,
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
  const idStatus = profile?.idv_status ?? null;
  const hasId = !!profile?.id_document_url;
  const idBadge = idStatus === "verified"
    ? { label: "Verified", cls: "bg-success/10 text-green-800 dark:text-green-400" }
    : (idStatus === "pending" || idStatus === "processing" || idStatus === "manual_review" || (hasId && !idStatus))
    ? { label: "Pending review", cls: "bg-warning/10 text-amber-800 dark:text-amber-400" }
    : idStatus === "failed"
    ? { label: "Action needed", cls: "bg-destructive/10 text-destructive" }
    // The chip and the button must never disagree, and they used to. This
    // fallback said "Not uploaded" for ANY status the chain above doesn't
    // name — and `not_started` is a real value the tier code writes, as is
    // any status a future Stripe IDV revision adds. A profile with a document
    // already on file therefore rendered the chip "Not uploaded" next to a
    // button reading "Replace": you cannot replace something never uploaded.
    // Both now branch on the same `hasId`, so the pair is consistent by
    // construction whatever `idv_status` happens to hold.
    : hasId
    ? { label: "Uploaded", cls: "bg-muted text-muted-foreground" }
    : { label: "Not uploaded", cls: "bg-muted text-muted-foreground" };
  const bioOk = bio.trim().length >= 20;
  const phoneValid = phone.replace(/\D/g, "").length >= 10;
  const locationValid = location.trim().length > 0;
  // Skills are stored as ONE comma-separated string (profiles.skills) — the
  // format every consumer already parses. Split here only to count and to
  // preview the pills the public profile will render.
  const skillList = skills.split(",").map((s) => s.trim()).filter(Boolean);

  // Dirty check — the Save bar drives only the text fields (avatar /
  // ID / portfolio persist on their own). Disabled when nothing in
  // this set has diverged from the saved profile.
  const dirty =
    phone !== (profile?.phone ?? "") ||
    location !== (profile?.location ?? "") ||
    zipCode !== (profile?.zip_code ?? "") ||
    bio !== (profile?.bio ?? "") ||
    skills !== (profile?.skills ?? "");

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

  return (
    // Bottom padding clears the sticky save bar (16+44+16 = 76px) plus a
    // safe-area buffer so the last form field doesn't tuck under the bar.
    // `var(--safe-area-bottom)` for the same reason as SaveBar's own padding:
    // a bare env() reads 0 under <PageTransition>'s promoted ancestor, so the
    // clearance quietly lost the home-indicator allowance.
    <div className="space-y-3" style={{ paddingBottom: "calc(var(--safe-area-bottom, 0px) + 6.5rem)" }}>
      <ProfileTabHeader
        title="Edit Profile"
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
        />

        {/* Contact section */}
        <div className="rounded-2xl liquid-glass p-5 space-y-4">
          <div className="space-y-3">
            <div>
              <Label htmlFor="phone" className="text-ds-11 mb-1.5 block">Phone</Label>
              <div className="relative">
                <Input id="phone" type="tel" inputMode="tel" autoComplete="tel" enterKeyHint="next" value={phone} onChange={(e) => setPhone(e.target.value)} className={`h-10 ${phoneValid ? "pr-10" : ""}`} />
                {phoneValid && (
                  <Check className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-primary pointer-events-none" strokeWidth={2.5} aria-hidden />
                )}
              </div>
            </div>
            <div className="grid grid-cols-3 gap-3">
              <div className="col-span-2">
                <Label htmlFor="location" className="text-ds-11 mb-1.5 block">City</Label>
                <div className="relative">
                  <Input id="location" autoComplete="address-level2" autoCapitalize="words" enterKeyHint="next" value={location} onChange={(e) => setLocation(e.target.value)} className={`h-10 ${locationValid ? "pr-10" : ""}`} />
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

        {/* Skills & services — restored 2026-08-27. `profiles.skills` had been
            written on save since April but had no input anywhere in `src/`
            (deleted by an unlabelled bot rewrite), so all 23 live profiles had
            it blank and the public-profile skill pills never rendered.

            STORAGE FORMAT: one comma-separated string, unchanged. Every
            consumer parses it that way — instant-job-match, useDashboardData's
            recommendation scoring, SavedHelperCard, useSavedHelpers' search
            filter and ProfileHeaderCard's pills — so a chip picker or an array
            column would have meant touching all five. A plain text field with
            a live pill preview gives the chip affordance without changing what
            is persisted. */}
        <div className="rounded-2xl liquid-glass p-5 space-y-3">
          <div className="flex items-baseline justify-between gap-3">
            <Label htmlFor="skills" className="text-ds-11 block">Skills &amp; services</Label>
            {skillList.length > 0 && (
              <span className="text-ds-11 font-medium text-success inline-flex items-center gap-1">
                <Check className="w-3 h-3" strokeWidth={3} /> {skillList.length} listed
              </span>
            )}
          </div>
          <Input
            id="skills"
            value={skills}
            onChange={(e) => setSkills(e.target.value)}
            placeholder="Cleaning, yard work, moving…"
            autoCapitalize="words"
            enterKeyHint="next"
            className="h-10"
          />
          {skillList.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {skillList.map((s, i) => (
                <span
                  key={`${s}-${i}`}
                  className="px-2 py-0.5 rounded-full text-ds-11 font-medium bg-primary/10 text-primary"
                >
                  {s}
                </span>
              ))}
            </div>
          )}
          <p className="font-serif italic leading-snug text-ds-12" style={{ color: "hsl(var(--olivewood) / 0.8)" }}>
            Separate each with a comma. These show as tags on your public profile and decide which jobs get matched to you.
          </p>
        </div>

        {/* Bio section */}
        <div className="rounded-2xl liquid-glass p-5 space-y-3">
          {/* A VISIBLE label, like every other field on this form. The bio
              carried its name in `aria-label` only, so a screen reader heard
              "About you" while a sighted user got an unlabelled box between a
              labelled "City / ZIP" row and an unlabelled ID card — the field
              that decides whether somebody hires you, and the one nobody could
              see the name of. `<label htmlFor>` supersedes the aria-label, so
              the two can no longer say different things. */}
          <div className="flex items-baseline justify-between gap-3">
            <Label htmlFor="bio" className="text-ds-11 block">About you</Label>
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
          <p className="font-serif italic leading-snug text-ds-12" style={{ color: "hsl(var(--olivewood) / 0.8)" }}>
            Customers read this when deciding who to hire. The more specific, the better.
          </p>
        </div>

        {/* ID Verification section. The status badge sits on the right, and a
            NAME sits on the left — the comment here used to argue "the body
            copy below identifies the section on its own", which was the same
            reasoning that left the bio unlabelled. It is true that you can work
            out what the card is from the sentence inside it; it is also true
            that every other card on this form tells you at a glance. This one
            is the section a helpr is most anxious about, and it opened with a
            status chip floating alone against a blank row. */}
        <div id="id-verification-card" className="rounded-2xl liquid-glass p-5 space-y-4 scroll-mt-24">
          <div className="flex items-baseline justify-between gap-2">
            <h2 className="text-ds-11 font-medium leading-none" style={{ color: "hsl(var(--ink-deep))" }}>
              ID verification
            </h2>
            <span className={`text-ds-9 px-1.5 py-0.5 rounded-full font-medium not-italic ${idBadge.cls}`}>{idBadge.label}</span>
          </div>
          <div className="flex items-center gap-3">
            <p className="font-serif italic leading-snug flex-1 text-ds-12" style={{ color: "hsl(var(--olivewood) / 0.8)" }}>
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
              {/* The accessible name goes on the INPUT, not the <label> — a
                  bare <label> has no implicit ARIA role, so `aria-label` on it
                  is ignored (same trap already documented in PhotoNameSection).
                  Without this the control announced as just "Replace" / a bare
                  file input; now it says what is being replaced, and it tracks
                  `hasId` exactly like the visible word does. */}
              <input
                type="file"
                aria-label={hasId ? "Replace your ID document" : "Upload your ID document"}
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
          anchorId="work-portfolio-card"
          portfolioUrls={portfolioUrls}
          portfolioUploading={portfolioUploading}
          portfolioInputRef={portfolioInputRef}
          handlePortfolioPick={handlePortfolioPick}
          removePortfolioAt={removePortfolioAt}
        />

        {/* No "Preview my public profile" here. It used to sit above the
            autosave note, but the Profile landing already carries the same
            entry point, and the landing is where Back from this tab lands
            (owner: "should we remove since its on the profile page now" —
            the button is right there in the profile). One preview affordance,
            one place. The autosave note stays: it explains the save model so
            the sticky bar's "Save changes" doesn't read as "nothing saved
            yet", which is a different job entirely. */}
        {/* Same one-paragraph-one-typeface rule as RecentWorkSection: this
            sentence used to switch from serif italic to upright sans halfway
            through ("…save from the" / "bar below"). Emphasis is weight +
            colour now; the family runs unbroken. */}
        <p
          className="text-center font-serif italic px-6 leading-snug text-ds-12"
          style={{ color: "hsl(var(--olivewood) / 0.8)" }}
        >
          Photos &amp; ID save automatically. Your other edits save from the{" "}
          <span className="font-semibold" style={{ color: "hsl(var(--ink-deep))" }}>bar below</span>.
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
