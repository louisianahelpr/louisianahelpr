import { useEffect, useState } from "react";
import { useKeyboardInset } from "@/hooks/useKeyboardInset";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Check, MapPin } from "lucide-react";
import { lookupParishByZip } from "@/lib/parishLookup";
import { JOB_CATEGORY_LABELS } from "@/lib/jobCategories";
import ProfileTabHeader from "@/components/profile/ProfileTabHeader";
import type { ProfileEditFormProps } from "@/components/profile/profileEditForm/types";
import { usePortfolio } from "@/components/profile/profileEditForm/usePortfolio";
import { PhotoNameSection } from "@/components/profile/profileEditForm/PhotoNameSection";
import { RecentWorkSection } from "@/components/profile/profileEditForm/RecentWorkSection";
import { SaveBar } from "@/components/profile/profileEditForm/SaveBar";

export type { ProfileEditFormProps } from "@/components/profile/profileEditForm/types";

// Preset skill chips — reuses the canonical job-category labels
// (src/lib/jobCategories.ts) so a Helpr's offered skills line up with the
// categories jobs actually get posted under, minus "Other" (that's the
// free-text field below the chips, not a chip itself). "Moving" and
// "Events" get a small wording nudge ("Moving Help" / "Event Help") since
// these describe a *skill offered*, not a job category being posted.
const SKILL_PRESETS: string[] = Object.entries(JOB_CATEGORY_LABELS)
  .filter(([value]) => value !== "other")
  .map(([value, label]) => (value === "moving" ? "Moving Help" : value === "events" ? "Event Help" : label));

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
  // Unused since the manual ID-upload card was removed (Stripe Identity owns
  // verification). Kept in the signature so the shared props type and the ~3
  // call sites don't churn; underscore marks them intentionally unread.
  idUploading: _idUploading,
  saving,
  justSaved,
  onSave,
  onAvatarUpload,
  onIdUpload: _onIdUpload,
  onBack,
  onPortfolioChange,
}: ProfileEditFormProps) {
  // ID-verification status locals removed with the manual-upload card —
  // Stripe Identity owns that status now (stripe-idv-start / -webhook).
  const bioOk = bio.trim().length >= 20;
  const phoneValid = phone.replace(/\D/g, "").length >= 10;
  const locationValid = location.trim().length > 0;
  // Skills are stored as ONE comma-separated string (profiles.skills) — the
  // format every consumer already parses. Split here only to count and to
  // preview the pills the public profile will render.
  const skillList = skills.split(",").map((s) => s.trim()).filter(Boolean);

  // Presets vs. custom ("Other") — split skillList by whether each entry
  // case-insensitively matches a preset chip label. Anything left over is
  // custom text a Helpr typed (or a skill saved before this chip picker
  // existed), so it must stay visible and editable, not silently dropped.
  const presetLabelsLower = new Set(SKILL_PRESETS.map((s) => s.toLowerCase()));
  const selectedPresets = skillList.filter((s) => presetLabelsLower.has(s.toLowerCase()));
  const customSkills = skillList.filter((s) => !presetLabelsLower.has(s.toLowerCase()));

  function toggleSkillPreset(label: string) {
    const isSelected = skillList.some((s) => s.toLowerCase() === label.toLowerCase());
    const next = isSelected
      ? skillList.filter((s) => s.toLowerCase() !== label.toLowerCase())
      : [...skillList, label];
    setSkills(next.join(", "));
  }

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

  // "Other" skills free-text — kept as its own local buffer (not derived
  // fresh from `skills` on every render) so typing a comma doesn't
  // instantly re-join/trim the field out from under the cursor. Resynced
  // only when the underlying saved profile's skills change (initial load /
  // navigating back to this tab), same trigger as resolvedParish above.
  const [customText, setCustomText] = useState(customSkills.join(", "));
  useEffect(() => {
    const saved = (profile?.skills ?? "").split(",").map((s) => s.trim()).filter(Boolean);
    const savedCustom = saved.filter((s) => !presetLabelsLower.has(s.toLowerCase()));
    setCustomText(savedCustom.join(", "));
    // presetLabelsLower is a stable module-derived Set each render; only
    // profile?.skills should re-trigger this resync.
  }, [profile?.skills]);

  function handleCustomTextChange(value: string) {
    setCustomText(value);
    const customList = value.split(",").map((s) => s.trim()).filter(Boolean);
    setSkills([...selectedPresets, ...customList].join(", "));
  }
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
          {/* Preset chips — tap to toggle in/out of the comma-separated
              `skills` string. Same active/inactive chip language as
              ReviewsTab's sort menu (bg-primary fill when selected). */}
          <div className="flex flex-wrap gap-1.5">
            {SKILL_PRESETS.map((label) => {
              const active = skillList.some((s) => s.toLowerCase() === label.toLowerCase());
              return (
                <button
                  key={label}
                  type="button"
                  onClick={() => toggleSkillPreset(label)}
                  aria-pressed={active}
                  className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-ds-11 font-medium transition-colors active:scale-95 ${
                    active
                      ? "bg-primary text-primary-foreground"
                      : "bg-primary/10 text-primary hover:bg-primary/15"
                  }`}
                >
                  {active && <Check className="w-3 h-3" strokeWidth={3} />}
                  {label}
                </button>
              );
            })}
          </div>
          <div>
            <Label htmlFor="skillsOther" className="text-ds-11 mb-1.5 block text-muted-foreground">
              Other (not listed above)
            </Label>
            <Input
              id="skillsOther"
              value={customText}
              onChange={(e) => handleCustomTextChange(e.target.value)}
              placeholder="Anything else you offer…"
              autoCapitalize="words"
              enterKeyHint="done"
              className="h-10"
            />
          </div>
          <p className="font-serif italic leading-snug text-ds-12" style={{ color: "hsl(var(--olivewood) / 0.8)" }}>
            Tap what applies, or type your own. These show as tags on your public profile and decide which jobs get matched to you.
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

        {/* ID verification card REMOVED (owner, 2026-08-30: "remove done by
            stripe"). This was a manual government-ID upload into the `avatars`
            bucket that set `idv_status: "pending"` for a human to review.
            Identity verification is Stripe Identity's job — see the
            `stripe-idv-start` / `stripe-idv-webhook` edge functions, which own
            the session and write the real status back. Two parallel ID paths
            meant a helpr could upload a document here that Stripe never saw,
            and sit "pending" behind a queue that no longer decides anything. */}

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
