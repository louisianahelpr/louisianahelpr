// SignupStep1 — "Create your account" step (UI step 1 of 2).
//
// Extracted from src/pages/auth/Signup.tsx. Owns no state of its own; every
// field is a controlled input bound to props lifted into the parent.
// Validation lives in the parent (validateAccountStep).
//
// Reusable input/label class constants are passed in so the parent stays
// the single source of truth for form styling.

import { useRef, useState, type KeyboardEvent } from "react";
import { Link } from "react-router-dom";
import { HelprMark } from "@/components/HelprMark";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { ArrowBigUp, Eye, EyeOff, Check, Circle, X } from "lucide-react";
import { SocialAuthButtons } from "@/components/auth/SocialAuthButtons";
import { OrRule } from "@/components/auth/OrRule";
import { SOCIAL_SIGN_IN_ENABLED } from "@/lib/socialAuth";
import {
  pendingEmailTypo,
  PASSWORD_RULES,
  PASSWORD_MIN_LENGTH,
  unmetPasswordRules,
  passwordProblem,
} from "./signupHelpers";
import { PasswordStrengthMeter } from "@/components/auth/PasswordStrengthMeter";

export interface SignupStep1Props {
  email: string;
  setEmail: (v: string) => void;
  password: string;
  setPassword: (v: string) => void;
  showPassword: boolean;
  setShowPassword: (v: boolean) => void;
  acceptedPolicies: boolean;
  setAcceptedPolicies: (v: boolean) => void;
  /** 18+ attestation — a hard requirement (legal age gate), UNCHECKED by default. */
  ageConfirmed: boolean;
  setAgeConfirmed: (v: boolean) => void;
  /** Marketing / promotional email opt-in — UNCHECKED by default, persisted to profiles.marketing_consent. */
  marketingConsent: boolean;
  setMarketingConsent: (v: boolean) => void;
  inputCls: string;
  labelCls: string;
  /** Called when the user clicks Continue — parent runs validation, then advances step. */
  onContinue: () => void | Promise<void>;
  /** Board 55's First name, the same value step 2 asks for (prefilled there). */
  firstName?: string;
  setFirstName?: (v: string) => void;
  /** A reason line (e.g. "Create an account to get alerts") in place of the default. */
  subtitle?: string;
}

// One password-rule chip of the live checklist. Module-level, not declared
// inside the render body: a component declared inside another is a new type
// every render, which remounts it each keystroke (see
// src/test/noNestedComponentDefinitions.test.ts).
const Req = ({ ok, label }: { ok: boolean; label: string }) => (
  <span className={`inline-flex items-center gap-1 text-ds-11 ${ok ? "text-primary" : "text-muted-foreground"}`}>
    {ok ? <Check className="w-3 h-3" strokeWidth={2.5} aria-hidden /> : <Circle className="w-3 h-3" strokeWidth={2} aria-hidden />}
    {label}
  </span>
);

export function SignupStep1({
  email,
  setEmail,
  password,
  setPassword,
  showPassword,
  setShowPassword,
  acceptedPolicies,
  setAcceptedPolicies,
  ageConfirmed,
  setAgeConfirmed,
  marketingConsent,
  setMarketingConsent,
  inputCls,
  labelCls,
  onContinue,
  firstName,
  setFirstName,
  subtitle,
}: SignupStep1Props) {
  // The Continue button stays visually active even before the policies box is
  // checked — a disabled grey button is a dead end the user can't learn from.
  // Tapping it while unchecked shakes + highlights the agreement box instead,
  // pointing them at the one thing they still have to do. `nudgeKey` re-mounts
  // the animation so repeated taps replay the shake.
  const [nudgeKey, setNudgeKey] = useState(0);
  // Set once Continue is tapped — lets the email field surface a "required"
  // error even before the user has typed anything.
  const [attempted, setAttempted] = useState(false);
  // True while a hardware Caps Lock is engaged (web/desktop only; harmless
  // no-op on the iOS soft keyboard, which never reports the modifier).
  const [capsLockOn, setCapsLockOn] = useState(false);

  const emailRef = useRef<HTMLInputElement>(null);
  const passwordRef = useRef<HTMLInputElement>(null);

  // Live field validity — mirrors the parent's validateAccountStep so the
  // form can gate inline (focus the first bad field) instead of firing a
  // stack of toasts on Continue.
  const emailValid = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
  // Derived from the shared rule list, NOT re-implemented. This line used to
  // read `password.length >= 8 && /[A-Z]/ && /\d/` — three of the five rules
  // the parent (and the Supabase project) actually enforce — so it waved
  // through passwords it then had to reject with a toast. See PASSWORD_RULES.
  const passwordValid = unmetPasswordRules(password).length === 0;
  // The address the member said is right as typed ("Keep it"), so the typo
  // check stops asking about exactly that address.
  const [keptEmail, setKeptEmail] = useState<string | null>(null);
  const emailSuggestion = emailValid ? pendingEmailTypo(email, keptEmail) : null;
  const suggestedDomain = emailSuggestion ? emailSuggestion.slice(emailSuggestion.lastIndexOf("@") + 1) : "";
  const typedDomain = email.slice(email.lastIndexOf("@") + 1).trim();
  // Shared by the field border and the message below it, so a field can never
  // show one without the other.
  const emailError = (email.length > 0 && !emailValid) || (attempted && !email.trim());
  const passwordError = (password.length > 0 && !passwordValid) || (attempted && !password);

  const handleContinue = () => {
    setAttempted(true);
    if (!emailValid) {
      emailRef.current?.focus();
      return;
    }
    // A likely typo (gmai.com, icloud.con) stops Continue until it is
    // answered: the confirmation email to a mistyped domain never arrives.
    if (emailSuggestion) {
      emailRef.current?.focus();
      return;
    }
    if (!passwordValid) {
      passwordRef.current?.focus();
      return;
    }
    // Continue stays active even when a required box is unchecked — tapping it
    // here shakes + highlights the offending box(es) instead of being a dead
    // grey button. `nudgeKey` re-mounts the labels so repeated taps replay the
    // shake. Both the policies agreement and the 18+ attestation are hard gates.
    if (!acceptedPolicies || !ageConfirmed) {
      setNudgeKey((k) => k + 1);
      return;
    }
    void onContinue();
  };

  // Enter walks the field chain (email → password → submit) so the form is
  // fully keyboard-drivable on web.
  const trackCaps = (e: KeyboardEvent<HTMLInputElement>) =>
    setCapsLockOn(e.getModifierState?.("CapsLock") ?? false);
  const onEmailKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      e.preventDefault();
      passwordRef.current?.focus();
    }
  };
  const onPasswordKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    trackCaps(e);
    if (e.key === "Enter") {
      e.preventDefault();
      handleContinue();
    }
  };

  return (
    <div className="space-y-5">
      {/* Board 55 (2026-10-20): the same card as Log in (board 37): the ROUND H
          app icon, "Create your account" and one line, the fields (labels
          above, no placeholder text: the owner's 2026-08-22 label-only rule),
          the olive pill, ONE consent line, then "or" and the providers.
          Behaviour unchanged: Continue still runs the parent's validation and
          opens step 2 (About you), where the account is created.
          Guard: src/test/signupBoard55.test.ts. */}
      <div className="flex flex-col items-center text-center gap-1.5" data-testid="signup-card-head">
        {/* Board 37/55: no back arrow; the round H icon is the way home. */}
        <div className="mb-2">
          {/* The H mark used everywhere else (owner 2026-10-20: never in a circle). */}
          <HelprMark to="/" size="lg" emblemOnly />
        </div>
        <h1 className="text-page-title text-foreground">Create your account</h1>
        <p className="text-ds-14 text-muted-foreground">{subtitle ?? "One account to hire, help, buy and sell."}</p>
      </div>

      <section className="space-y-3.5">
        {setFirstName && (
          <div className="space-y-2">
            {/* The same first name step 2 asks for (prefilled there). */}
            <Label htmlFor="signup-first-name" className={labelCls}>First name</Label>
            <Input id="signup-first-name" value={firstName ?? ""} onChange={(e) => setFirstName(e.target.value)} autoComplete="given-name" autoCapitalize="words" enterKeyHint="next" className={inputCls} />
          </div>
        )}
        <div className="space-y-2">
          {/* Single email field — confirm-email was removed since
              email-verification (the click-the-link step after signup)
              already catches typos. The double field was 2014-era
              friction that costs activations without preventing errors. */}
          <Label htmlFor="email" className={labelCls}>Email</Label>
          <div className="relative">
            <Input ref={emailRef} id="email" type="email" inputMode="email" autoCapitalize="none" autoCorrect="off" spellCheck={false} enterKeyHint="next" value={email} onChange={(e) => setEmail(e.target.value)} onKeyDown={onEmailKeyDown} required autoComplete="email" aria-invalid={emailError} aria-describedby={emailError ? "signup-email-error" : undefined}
              className={`${inputCls} ${emailValid ? "pr-10" : ""} ${emailError ? "!border-destructive focus-visible:!border-destructive" : ""}`} />
            {/* No green check over a likely typo: it read as "this is right". */}
            {emailValid && !emailSuggestion && (
              <Check className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-primary pointer-events-none" strokeWidth={2.5} aria-hidden />
            )}
          </div>
          {/* No asterisks (board 55, the same as Log in): every field on this
              card is needed, and a missed one is named below it on Continue. */}
          {/* The message accompanies the red border in BOTH failure shapes —
              a malformed address AND an untouched field after Continue. The
              empty case used to paint the border with no words at all, which
              is a "something's wrong" with no path out. */}
          {emailError && (
            <p id="signup-email-error" role="alert" className="inline-flex items-center gap-1 text-ds-11 text-[hsl(var(--destructive-ink))]">
              <X className="w-3.5 h-3.5" strokeWidth={2.5} aria-hidden />
              {email.trim() ? "Enter a valid email address" : "Add your email address"}
            </p>
          )}
          {emailSuggestion && (
            <div
              role={attempted ? "alert" : "status"}
              data-testid="signup-email-typo"
              className="rounded-ds-md px-3 py-2.5 space-y-2 text-ds-13 font-sans"
              style={{ background: "hsl(var(--bark) / 0.08)", color: "hsl(var(--ink-deep))" }}
            >
              <p>
                Did you mean <span className="font-semibold break-all">{emailSuggestion}</span>?
              </p>
              <div className="flex flex-wrap gap-2">
                <Button type="button" size="sm" variant="outline" className="rounded-full font-semibold" onClick={() => setEmail(emailSuggestion)}>
                  Use {suggestedDomain}
                </Button>
                <Button type="button" size="sm" variant="outline" className="rounded-full" onClick={() => setKeptEmail(email)}>
                  Keep {typedDomain}
                </Button>
              </div>
            </div>
          )}
        </div>
        <div className="space-y-2">
          <Label htmlFor="password" className={labelCls}>Password</Label>
          <div className="relative">
            <Input ref={passwordRef} id="password" type={showPassword ? "text" : "password"} enterKeyHint="next" value={password} onChange={(e) => setPassword(e.target.value)} onKeyDown={onPasswordKeyDown} onKeyUp={trackCaps} required minLength={PASSWORD_MIN_LENGTH} aria-invalid={passwordError} aria-describedby={passwordError ? "signup-password-error" : undefined}
              className={`${inputCls} pr-10 ${passwordError ? "!border-destructive focus-visible:!border-destructive" : ""}`} autoComplete="new-password" />
            <button
              type="button"
              onClick={() => setShowPassword(!showPassword)}
              aria-label={showPassword ? "Hide password" : "Show password"}
              className="absolute right-0 top-1/2 -translate-y-1/2 w-11 h-11 flex items-center justify-center text-muted-foreground hover:text-foreground transition-colors"
            >
              {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
            </button>
          </div>
          {capsLockOn && (
            <p className="inline-flex items-center gap-1 text-ds-11" style={{ color: "hsl(var(--alert-ink))" }}>
              <ArrowBigUp className="w-3.5 h-3.5" strokeWidth={2} aria-hidden /> Caps Lock is on
            </p>
          )}
          {/* The message must cover BOTH failure modes the red border covers.
              It used to render only for `attempted && !password`, so an empty
              field said "Add a password" while a weak one — the far more
              common case — got the border, a focus jump and silence. The
              `passwordError` condition is the same boolean that paints the
              border, so the two can no longer disagree. */}
          {passwordError && (
            <p id="signup-password-error" role="alert" className="inline-flex items-start gap-1 text-ds-11 text-[hsl(var(--destructive-ink))]">
              <X className="w-3.5 h-3.5 shrink-0 mt-px" strokeWidth={2.5} aria-hidden />
              {password ? passwordProblem(password) : "Add a password"}
            </p>
          )}
          {/* The one shared strength meter (also on Reset password). */}
          <PasswordStrengthMeter password={password} />
          {(() => {
            // Real-time checklist, rendered from PASSWORD_RULES rather than
            // from a hand-copied subset. It listed three of the five rules,
            // which meant "Lowercase" and "Symbol" — both enforced by the
            // Supabase project — were never stated until they caused a
            // rejection. Shown from the start (not just once the user types)
            // so the rules set expectations before the first keystroke.
            return (
              <div className="flex flex-wrap gap-x-3 gap-y-1 px-0.5 mt-1">
                {PASSWORD_RULES.map((rule) => (
                  <Req key={rule.label} ok={rule.test(password)} label={rule.label} />
                ))}
              </div>
            );
          })()}
        </div>
      </section>

      {/* ONE consent line (board 55): the 18+ attestation and the Terms, Rules
          and Privacy agreement are one box that records BOTH (acceptedPolicies
          and ageConfirmed, exactly as the two boxes did). Continue stays
          active while it is unticked: a tap shakes the line instead of a dead
          grey button. New tabs, not in-app links: /signup keeps no draft. */}
      <div className="space-y-0">
      <label
        key={nudgeKey}
        htmlFor="policies"
        className={`flex items-start gap-3 px-1.5 py-2 min-h-[44px] [@media(pointer:fine)]:min-h-0 rounded-ds-md cursor-pointer transition-colors ${nudgeKey > 0 && !(acceptedPolicies && ageConfirmed) ? "animate-attention-nudge" : ""}`}
        style={{
          border: nudgeKey > 0 && !(acceptedPolicies && ageConfirmed) ? "1px solid hsl(var(--alert) / 0.55)" : "1px solid transparent",
        }}
      >
        <Checkbox
          id="policies"
          aria-labelledby="policies-label"
          aria-invalid={nudgeKey > 0 && !(acceptedPolicies && ageConfirmed)}
          checked={acceptedPolicies && ageConfirmed}
          onCheckedChange={(checked) => {
            setAcceptedPolicies(checked === true);
            setAgeConfirmed(checked === true);
          }}
          className="h-5 w-5 mt-[1px] shrink-0 [&_svg]:h-4 [&_svg]:w-4"
        />
        <span id="policies-label" className="text-ds-13 leading-snug font-sans text-muted-foreground">
          I'm 18 or older and agree to the{" "}
          <a href="/terms" target="_blank" rel="noopener noreferrer" onClick={(e) => e.stopPropagation()} className="font-semibold underline text-primary">Terms</a>,{" "}
          <a href="/rules" target="_blank" rel="noopener noreferrer" onClick={(e) => e.stopPropagation()} className="font-semibold underline text-primary">Rules</a> and{" "}
          <a href="/privacy" target="_blank" rel="noopener noreferrer" onClick={(e) => e.stopPropagation()} className="font-semibold underline text-primary">Privacy</a>.
        </span>
      </label>

      {/* Marketing email opt-in: optional, UNCHECKED by default, persisted to
          profiles.marketing_consent so send-marketing-blast filters honestly. */}
      <label
        htmlFor="marketing-consent"
        className="flex items-start gap-3 px-1.5 py-2 min-h-[44px] [@media(pointer:fine)]:min-h-0 rounded-ds-md cursor-pointer"
      >
        <Checkbox
          id="marketing-consent"
          aria-labelledby="marketing-consent-label"
          checked={marketingConsent}
          onCheckedChange={(checked) => setMarketingConsent(checked === true)}
          className="h-5 w-5 mt-[1px] shrink-0 [&_svg]:h-4 [&_svg]:w-4"
        />
        <span id="marketing-consent-label" className="text-ds-13 leading-snug font-sans text-muted-foreground">
          Email me occasional Helpr news and offers.
        </span>
      </label>

      {/* Screen-reader parity for the consent gate: the shake is visual only.
          Keyed on nudgeKey so a repeat tap re-announces. */}
      <p key={`consent-alert-${nudgeKey}`} role="alert" className="sr-only">
        {nudgeKey > 0 && !(acceptedPolicies && ageConfirmed)
          ? "To continue, confirm you are 18 or older and agree to the Terms, Rules and Privacy."
          : ""}
      </p>
      </div>

      {/* Continue sits BELOW the consent (Q2256 / audit #44, owner 2026-10-21:
          keep the one combined Terms + 18+ box, read before the action). */}
      <Button
        variant="primary"
        className="w-full rounded-full"
        size="lg"
        onClick={handleContinue}
      >
        Continue
      </Button>

      {/* Continue saves the email for ONE reminder if sign-up is not finished
          (owner 2026-10-09; src/lib/signupLead.ts). Said before it happens. */}
      <p className="text-center text-ds-12 font-sans text-muted-foreground">
        We may email you once if you don't finish signing up.
      </p>

      {SOCIAL_SIGN_IN_ENABLED && (
        <>
          <OrRule />
          <SocialAuthButtons />
        </>
      )}

      <p className="text-center text-ds-12 font-sans" style={{ color: "hsl(var(--olivewood) / 0.8)" }}>
        Already have an account?{" "}
        <Link to="/login" className="font-semibold hover:underline whitespace-nowrap" style={{ color: "hsl(var(--bark))" }}>
          Log in
        </Link>
      </p>
    </div>
  );
}
