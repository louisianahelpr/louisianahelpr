// SignupStep2 — "Tell us about you." (UI step 2 of 2 — the final step).
//
// Profile picture, name, contact, basic identity + government ID upload.
// Like Step1, owns no state — every field is bound through props lifted
// into the parent. File handlers (avatar + ID) are passed in as
// callbacks so the validateFile / state-setter wiring stays in one place.
//
// Validation lives in the parent (validateAboutYouStep).

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Camera,
  UserRound,
  AlertCircle,
  Check,
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
  // Bare "… is required" is suppressed: the red asterisk on the label and the
  // red field border already say it, so printing it a third time is noise.
  // Messages that TEACH something — "You must be at least 18 years old",
  // "Enter a valid 10-digit phone number" — still render.
  if (!message || /is required\.?$/i.test(message.trim())) return null;
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
  /**
   * Called when the user clicks the primary button — parent runs validation,
   * then creates the account (Step 2 is the final step).
   */
  onContinue: () => void | Promise<void>;
  /** Account creation in flight — disables the button and shows a busy label. */
  loading?: boolean;
}


export function SignupStep2(props: SignupStep2Props) {
  const {
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
    bio,
    setBio,
    inputCls,
    labelCls,
    fieldErrors = {},
    clearFieldError,
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

  return (
    <div className="space-y-6">

      {/* Section 2: Your name + personal details */}
      <section className="space-y-3">
        {/* Photo owns its own row above the names. Inline beside them it
            pushed First/Last to x=273 while every field below started at
            x=129 — a visible step down the form's left edge. */}
        <div className="space-y-2 text-center pb-3">
          <Label htmlFor="avatar" className={labelCls}>Profile photo <span aria-hidden style={{ color: "hsl(var(--destructive))" }}>*</span></Label>
          <div className="flex flex-col items-center gap-1.5">
          <label className="cursor-pointer group relative inline-block active:scale-[0.98] transition-transform rounded-full focus-within:outline focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-ring">
            <div
              className={`relative w-20 h-20 rounded-full border-2 border-dashed transition-colors flex items-center justify-center overflow-hidden ${fieldErrors.avatar ? "border-destructive" : "border-border group-hover:border-primary"}`}
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
                <UserRound className="w-8 h-8 text-muted-foreground" strokeWidth={1.5} />
              )}
            </div>
            <div
              className="pointer-events-none absolute -bottom-0.5 -right-0.5 w-8 h-8 rounded-full flex items-center justify-center z-10"
              style={{
                background:
                  "linear-gradient(150deg, hsl(var(--bark) / 0.92) 0%, hsl(var(--bark)) 60%)",
                color: "hsl(var(--parchment))",
                boxShadow:
                  "0 0 0 2.5px hsl(var(--parchment)), " +
                  "inset 0 1px 1px hsl(var(--parchment) / 0.25), " +
                  "0 8px 18px -4px hsl(var(--bark) / 0.55)",
              }}
            >
              <Camera className="w-3.5 h-3.5" strokeWidth={2.25} />
            </div>
            {/* sr-only (not `hidden`): display:none removes the input from the
                tab order, which would put the photo out of a keyboard-only
                user's reach entirely. sr-only keeps it focusable; the dashed
                circle shows the ring via focus-within. */}
            <input
              id="avatar"
              type="file"
              accept="image/*"
              className="sr-only"
              aria-invalid={!!fieldErrors.avatar}
              aria-describedby={fieldErrors.avatar ? "avatar-error" : undefined}
              onChange={(e) => { onAvatarChange(e); clearFieldError?.("avatar"); }}
            />
          </label>
          <FieldError id="avatar-error" message={fieldErrors.avatar} />
          </div>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-2">
            <Label htmlFor="firstName" className={labelCls}>First name <span aria-hidden style={{ color: "hsl(var(--destructive))" }}>*</span></Label>
            <div className="relative">
              <Input id="firstName" value={firstName} onChange={(e) => { setFirstName(e.target.value); clearFieldError?.("firstName"); }} required aria-required="true" autoComplete="given-name" autoCapitalize="words" aria-invalid={!!fieldErrors.firstName} aria-describedby={fieldErrors.firstName ? "firstName-error" : undefined} className={`${inputCls}${firstNameValid && !fieldErrors.firstName ? " pr-10" : ""}${fieldErrors.firstName ? " border-destructive" : ""}`} />
              {firstNameValid && !fieldErrors.firstName && (
                <Check className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-primary pointer-events-none" strokeWidth={2.5} aria-hidden />
              )}
            </div>
            <FieldError id="firstName-error" message={fieldErrors.firstName} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="lastName" className={labelCls}>Last name <span aria-hidden style={{ color: "hsl(var(--destructive))" }}>*</span></Label>
            <div className="relative">
              <Input id="lastName" value={lastName} onChange={(e) => { setLastName(e.target.value); clearFieldError?.("lastName"); }} required aria-required="true" autoComplete="family-name" autoCapitalize="words" aria-invalid={!!fieldErrors.lastName} aria-describedby={fieldErrors.lastName ? "lastName-error" : undefined} className={`${inputCls}${lastNameValid && !fieldErrors.lastName ? " pr-10" : ""}${fieldErrors.lastName ? " border-destructive" : ""}`} />
              {lastNameValid && !fieldErrors.lastName && (
                <Check className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-primary pointer-events-none" strokeWidth={2.5} aria-hidden />
              )}
            </div>
            <FieldError id="lastName-error" message={fieldErrors.lastName} />
          </div>
        </div>
        {/* Date of birth pairs half-width with Phone: it keeps one left
            edge with every field below, and a short date never needs a
            full-width control. */}
        <div className="grid grid-cols-2 gap-3 items-start">
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
              wheel
              showCompleteCheck
              id="dob"
              value={dateOfBirth}
              onChange={(v) => { setDateOfBirth(v); clearFieldError?.("dateOfBirth"); }}
              min={minDob}
              max={maxDob}
              aria-invalid={!!fieldErrors.dateOfBirth}
              aria-describedby={fieldErrors.dateOfBirth ? "dob-error" : undefined}
              className={`rounded-ds-md border-[hsl(var(--bark)/0.28)] dark:border-white/15${fieldErrors.dateOfBirth ? " border-destructive" : ""}`}
            />
            <FieldError id="dob-error" message={fieldErrors.dateOfBirth} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="phone" className={labelCls}>Phone number <span aria-hidden style={{ color: "hsl(var(--destructive))" }}>*</span></Label>
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
                value={phone}
                onChange={(e) => { setPhone(formatPhone(e.target.value)); clearFieldError?.("phone"); }}
                required
                aria-required="true"
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
        </div>
        {/* No City field. It was free text with nothing behind it — any
            string was accepted, so it collected values that were not real
            Louisiana cities and `profiles.location` filled up with garbage.
            Removed rather than "validated": a trustworthy city needs a picker
            or geocode lookup, and signup is the wrong place to add that
            friction. The column is untouched and still settable from Profile.
            Owner decision 2026-08-22. */}
        <div className="space-y-2">
          <Label htmlFor="bio" className={labelCls}>About you <span className="font-normal" style={{ color: "hsl(var(--olivewood) / 0.7)" }}>(optional)</span></Label>
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

      {/* One back control only. The card's header row already carries a back
          arrow, and two arrows on one screen is ambiguous. */}
      <div className="flex gap-3">
        <Button
          variant="primary"
          className="flex-1 rounded-ds-md"
          size="lg"
          onClick={onContinue}
          // Stays tappable while fields are missing — tapping runs
          // validateAboutYouStep, which names every unfinished field at once
          // (same pattern step 1's Continue adopted: an empty submit explains
          // itself instead of a wordless disabled button + red asterisks).
          disabled={loading}
        >
          {loading ? "Creating Account…" : "Create Account"}
        </Button>
      </div>
    </div>
  );
}
