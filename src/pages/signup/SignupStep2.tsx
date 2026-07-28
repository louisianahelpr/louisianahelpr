// SignupStep2 — "Tell us about you." (UI step 2 of 2 — the final step).
//
// Profile picture, name, contact, basic identity + government ID upload.
// Like Step1, owns no state — every field is bound through props lifted
// into the parent. File handlers (avatar + ID) are passed in as
// callbacks so the validateFile / state-setter wiring stays in one place.
//
// Validation lives in the parent (validateAboutYouStep).

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Building2,
  Camera,
  ArrowLeft,
  UserRound,
  UserCircle2,
  AlertCircle,
  Check,
  Info,
} from "lucide-react";
import { DatePickerField } from "@/components/DatePickerField";
import { formatPhone } from "./signupHelpers";

/**
 * Renders a red inline error message below a form field.
 *
 * Accessibility: the `id` is required so the paired form control can
 * reference it via `aria-describedby`, and `role="alert"` makes screen
 * readers announce the message the moment it renders. Without both, the
 * error is a visually-adjacent but programmatically-orphaned paragraph.
 */
function FieldError({ id, message }: { id: string; message?: string }) {
  if (!message) return null;
  return (
    <p
      id={id}
      role="alert"
      className="flex items-center gap-1 text-ds-11 text-destructive mt-1"
    >
      <AlertCircle className="w-3 h-3 shrink-0" aria-hidden />
      {message}
    </p>
  );
}

export interface SignupStep2Props {
  isBusinessSignup: boolean;
  companyName: string;
  setCompanyName: (v: string) => void;
  avatarFile: File | null;
  avatarPreview: string | null;
  onAvatarChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
  firstName: string;
  setFirstName: (v: string) => void;
  lastName: string;
  setLastName: (v: string) => void;
  phone: string;
  setPhone: (v: string) => void;
  dateOfBirth: string;
  setDateOfBirth: (v: string) => void;
  location: string;
  setLocation: (v: string) => void;
  bio: string;
  setBio: (v: string) => void;
  inputCls: string;
  labelCls: string;
  /**
   * Map of field key → error message string. Populated by the parent's
   * validateAboutYouStep() so ALL missing fields are shown at once.
   */
  fieldErrors?: Record<string, string>;
  /** Called when the user edits a field, to clear its individual error. */
  clearFieldError?: (key: string) => void;
  /** Called when the user clicks Back. */
  onBack: () => void;
  /**
   * Called when the user clicks the primary button — parent runs validation,
   * then creates the account (Step 2 is the final step).
   */
  onContinue: () => void | Promise<void>;
  /** Account creation in flight — disables the button and shows a busy label. */
  loading?: boolean;
}

/**
 * Tiny "why we need this" tooltip used on the phone field. Click/tap to
 * toggle (mobile-friendly), focusable so a keyboard user can reach it.
 * Renders inline so layout doesn't shift when it opens.
 */
function PhoneWhyTooltip() {
  const [open, setOpen] = useState(false);
  return (
    <span className="relative inline-flex items-center">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        onBlur={() => setOpen(false)}
        aria-label="Why we need your phone number"
        aria-expanded={open}
        className="inline-flex items-center justify-center w-4 h-4 rounded-full text-muted-foreground hover:text-foreground transition-colors"
      >
        <Info className="w-3.5 h-3.5" strokeWidth={1.75} aria-hidden />
      </button>
      {open && (
        <span
          role="tooltip"
          className="absolute left-5 top-1/2 -translate-y-1/2 z-30 w-56 rounded-ds-md px-3 py-2 text-ds-11 font-sans shadow-md"
          style={{
            background: "hsl(var(--ink-deep))",
            color: "hsl(var(--parchment))",
            lineHeight: 1.35,
          }}
        >
          We use your phone for job alerts and emergency contact only — never
          shared publicly or sold.
        </span>
      )}
    </span>
  );
}

export function SignupStep2(props: SignupStep2Props) {
  const {
    isBusinessSignup,
    companyName,
    setCompanyName,
    avatarPreview,
    onAvatarChange,
    firstName,
    setFirstName,
    lastName,
    setLastName,
    phone,
    setPhone,
    dateOfBirth,
    setDateOfBirth,
    location,
    setLocation,
    bio,
    setBio,
    inputCls,
    labelCls,
    fieldErrors = {},
    clearFieldError,
    onBack,
    onContinue,
    loading = false,
  } = props;

  // DOB picker bounds. Upper bound = today − 18y (blocks under-18 at the UI
  // layer; validateAboutYouStep re-checks age as the backstop). Lower bound =
  // today − 120y so the year dropdown has a sane floor.
  const maxDob = (() => {
    const d = new Date();
    d.setFullYear(d.getFullYear() - 18);
    return d.toISOString().split("T")[0];
  })();
  const minDob = (() => {
    const d = new Date();
    d.setFullYear(d.getFullYear() - 120);
    return d.toISOString().split("T")[0];
  })();

  // Live field validity — drives the inline green check (mirrors Step 1's
  // email affordance) so a completed field reads as done, not just un-erroed.
  const firstNameValid = firstName.trim().length > 0;
  const lastNameValid = lastName.trim().length > 0;
  const phoneValid = phone.replace(/\D/g, "").length >= 10;
  const locationValid = location.trim().length > 0;

  return (
    <div className="space-y-6">

      {/* Section 2: Your name + personal details */}
      <section className="space-y-3">
        <div className="flex items-center gap-2">
          <span className="text-display-eyebrow" style={{ fontSize: "0.7rem", letterSpacing: "0.1em", opacity: 0.85 }}>Your details</span>
        </div>
        {/* Avatar sits INLINE beside the name fields. Centred above the
            form it was a 158px band — a 112px circle plus a two-line
            caption — putting an OPTIONAL field first on the screen. */}
        <div className="flex items-start gap-4">
          <div className="shrink-0 flex flex-col items-center gap-1.5">
          <label className="cursor-pointer group relative inline-block active:scale-[0.98] transition-transform">
            <div
              className="relative w-24 h-24 rounded-full border-2 border-dashed border-border group-hover:border-primary transition-colors flex items-center justify-center overflow-hidden"
              style={{
                background:
                  "radial-gradient(circle at 50% 35%, hsl(var(--parchment)) 0%, hsl(var(--secondary) / 0.55) 100%)",
                boxShadow:
                  "inset 0 2px 6px hsl(var(--bark) / 0.12), " +
                  "0 8px 20px -10px hsl(var(--bark) / 0.35)",
              }}
            >
              {avatarPreview && avatarPreview.startsWith("blob:") ? (
                <img loading="lazy" decoding="async" src={avatarPreview} alt="Avatar" className="w-full h-full object-cover" />
              ) : (
                <UserRound className="w-10 h-10 text-muted-foreground" strokeWidth={1.5} />
              )}
            </div>
            <div
              className="pointer-events-none absolute -bottom-1 -right-1 w-9 h-9 rounded-full flex items-center justify-center z-10"
              style={{
                background:
                  "linear-gradient(150deg, hsl(var(--bark) / 0.92) 0%, hsl(var(--bark)) 60%)",
                color: "hsl(var(--parchment))",
                boxShadow:
                  "0 0 0 3px hsl(var(--parchment)), " +
                  "inset 0 1px 1px hsl(var(--parchment) / 0.25), " +
                  "0 8px 18px -4px hsl(var(--bark) / 0.55)",
              }}
            >
              <Camera className="w-4 h-4" strokeWidth={2.25} />
            </div>
            <input
              type="file"
              accept="image/*"
              className="hidden"
              aria-label="Profile photo"
              aria-invalid={!!fieldErrors.avatar}
              aria-describedby={fieldErrors.avatar ? "avatar-error" : undefined}
              onChange={(e) => { onAvatarChange(e); clearFieldError?.("avatar"); }}
            />
          </label>
          <FieldError id="avatar-error" message={fieldErrors.avatar} />
          </div>
          <div className="grid grid-cols-2 gap-3 flex-1 min-w-0">
          <div className="space-y-2">
            <Label htmlFor="firstName" className={labelCls}>First name <span aria-hidden style={{ color: "hsl(var(--destructive))" }}>*</span></Label>
            <div className="relative">
              <Input id="firstName" placeholder="Jane" value={firstName} onChange={(e) => { setFirstName(e.target.value); clearFieldError?.("firstName"); }} required aria-required="true" autoComplete="given-name" autoCapitalize="words" aria-invalid={!!fieldErrors.firstName} aria-describedby={fieldErrors.firstName ? "firstName-error" : undefined} className={`${inputCls}${firstNameValid && !fieldErrors.firstName ? " pr-10" : ""}${fieldErrors.firstName ? " border-destructive" : ""}`} />
              {firstNameValid && !fieldErrors.firstName && (
                <Check className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-primary pointer-events-none" strokeWidth={2.5} aria-hidden />
              )}
            </div>
            <FieldError id="firstName-error" message={fieldErrors.firstName} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="lastName" className={labelCls}>Last name <span aria-hidden style={{ color: "hsl(var(--destructive))" }}>*</span></Label>
            <div className="relative">
              <Input id="lastName" placeholder="Doe" value={lastName} onChange={(e) => { setLastName(e.target.value); clearFieldError?.("lastName"); }} required aria-required="true" autoComplete="family-name" autoCapitalize="words" aria-invalid={!!fieldErrors.lastName} aria-describedby={fieldErrors.lastName ? "lastName-error" : undefined} className={`${inputCls}${lastNameValid && !fieldErrors.lastName ? " pr-10" : ""}${fieldErrors.lastName ? " border-destructive" : ""}`} />
              {lastNameValid && !fieldErrors.lastName && (
                <Check className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-primary pointer-events-none" strokeWidth={2.5} aria-hidden />
              )}
            </div>
            <FieldError id="lastName-error" message={fieldErrors.lastName} />
          </div>
          </div>
        </div>
        {/* Date of birth sits above Phone: it is REQUIRED (red asterisk,
            enforced in validateAboutYouStep), and a required field should
            not come after optional ones. */}
        <div className="space-y-2">
          <Label htmlFor="dob" className={labelCls}>Date of birth <span aria-hidden style={{ color: "hsl(var(--destructive))" }}>*</span></Label>
          {/* Single native date field — on iOS this opens the system wheel
              picker (one tap), and `max` (today − 18y) keeps the wheel near a
              plausible birth year and blocks under-18 dates at the UI layer;
              validateAboutYouStep still re-checks age as the backstop. */}
          {/* DatePickerField (the app's shared tap-to-open calendar pill)
              instead of a raw <input type="date"> — the native control renders
              as a blank, oversized box on iOS with no placeholder. */}
          <DatePickerField
            id="dob"
            value={dateOfBirth}
            onChange={(v) => { setDateOfBirth(v); clearFieldError?.("dateOfBirth"); }}
            min={minDob}
            max={maxDob}
            placeholder="Select your date of birth"
            className={`rounded-ds-md border-[hsl(var(--bark)/0.28)] dark:border-white/15${fieldErrors.dateOfBirth ? " border-destructive" : ""}`}
          />
          {fieldErrors.dateOfBirth
            ? <FieldError id="dob-error" message={fieldErrors.dateOfBirth} />
            : <p id="dob-help" className="text-ds-11" style={{ color: "hsl(var(--olivewood) / 0.8)" }}>You must be at least 18 years old.</p>
          }
        </div>
        <div className="space-y-2">
          <div className="flex items-center gap-1.5 mb-2">
            <Label htmlFor="phone" className={`${labelCls} !mb-0`}>Phone number</Label>
            <PhoneWhyTooltip />
          </div>
          <div className="relative">
            {/* Country code badge — Helpr is Louisiana-only, so every
                number is +1. Showing it inline makes the formatting
                expectation explicit instead of leaving the user wondering
                whether to type the leading 1. */}
            <span
              className="absolute left-3 top-1/2 -translate-y-1/2 text-ds-13 font-sans font-medium pointer-events-none select-none"
              style={{ color: "hsl(var(--olivewood) / 0.8)" }}
              aria-hidden
            >
              +1
            </span>
            <Input
              id="phone"
              type="tel"
              inputMode="tel"
              placeholder="(555) 123-4567"
              value={phone}
              onChange={(e) => { setPhone(formatPhone(e.target.value)); clearFieldError?.("phone"); }}
              autoComplete="tel"
              maxLength={14}
              aria-invalid={!!fieldErrors.phone}
              aria-describedby={fieldErrors.phone ? "phone-error" : undefined}
              className={`${inputCls} pl-9${phoneValid && !fieldErrors.phone ? " pr-10" : ""}${fieldErrors.phone ? " border-destructive" : ""}`}
            />
            {phoneValid && !fieldErrors.phone && (
              <Check className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-primary pointer-events-none" strokeWidth={2.5} aria-hidden />
            )}
          </div>
          <FieldError id="phone-error" message={fieldErrors.phone} />
        </div>
        <div className="space-y-2">
          <Label htmlFor="location" className={labelCls}>City</Label>
          <div className="relative">
            <Input id="location" placeholder="e.g. Baton Rouge, LA" value={location} onChange={(e) => { setLocation(e.target.value); clearFieldError?.("location"); }} autoComplete="address-level2" autoCapitalize="words" enterKeyHint="next" aria-invalid={!!fieldErrors.location} aria-describedby={fieldErrors.location ? "location-error" : undefined} className={`${inputCls}${locationValid && !fieldErrors.location ? " pr-10" : ""}${fieldErrors.location ? " border-destructive" : ""}`} />
            {locationValid && !fieldErrors.location && (
              <Check className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-primary pointer-events-none" strokeWidth={2.5} aria-hidden />
            )}
          </div>
          <FieldError id="location-error" message={fieldErrors.location} />
        </div>
        <div className="space-y-2">
          <Label htmlFor="bio" className={labelCls}>About you</Label>
          <Textarea
            id="bio"
            placeholder="Tell us a bit about yourself — whether you're looking for work or need help around the house…"
            value={bio}
            onChange={(e) => { setBio(e.target.value); clearFieldError?.("bio"); }}
            autoCapitalize="sentences"
            rows={4}
            aria-invalid={!!fieldErrors.bio}
            aria-describedby={fieldErrors.bio ? "bio-error" : "bio-help"}
            className={`rounded-ds-md${fieldErrors.bio ? " border-destructive" : ""}`}
          />
          {fieldErrors.bio
            ? <FieldError id="bio-error" message={fieldErrors.bio} />
            : <p id="bio-help" className="text-ds-11 text-muted-foreground">
                You can always add this later from your profile.
              </p>
          }
        </div>
      </section>

      {/* Identity verification is no longer collected at signup — it's
          gated later (first job posted / first job worked), matching the
          complete-signup edge function, which auto-approves new accounts
          without an ID and only requires one on denied-account resubmission. */}

      <div className="flex gap-3">
        <Button variant="outline" size="lg" className="w-14 shrink-0 rounded-ds-md px-0" onClick={onBack} disabled={loading} aria-label="Back">
          <ArrowLeft className="w-4 h-4" />
        </Button>
        <Button
          variant="bark"
          className="flex-1 rounded-ds-md"
          size="lg"
          onClick={onContinue}
          disabled={loading}
        >
          {loading ? "Creating account…" : "Create account"}
        </Button>
      </div>
    </div>
  );
}
