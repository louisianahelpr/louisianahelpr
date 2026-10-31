// SignupStep1 — "Create your account" step (UI step 1 of 2).
//
// Extracted from src/pages/auth/Signup.tsx. Owns no state of its own; every
// field is a controlled input bound to props lifted into the parent.
// Validation lives in the parent (validateAccountStep).
//
// Reusable input/label class constants are passed in so the parent stays
// the single source of truth for form styling.

import { useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { HelprMark } from "@/components/HelprMark";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { ArrowBigUp, Eye, EyeOff, Check, X } from "lucide-react";
import { SocialAuthButtons } from "@/components/auth/SocialAuthButtons";
import { OrRule } from "@/components/auth/OrRule";
import { SOCIAL_SIGN_IN_ENABLED } from "@/lib/socialAuth";
import {
  pendingEmailTypo,
  PASSWORD_MIN_LENGTH,
  unmetPasswordRules,
  passwordProblem,
} from "./signupHelpers";
import { PasswordStrengthMeter } from "@/components/auth/PasswordStrengthMeter";
import { useLanguage } from "@/lib/i18n/language";
import { LanguageToggle } from "@/components/LanguageToggle";
import "@/lib/i18n/enScreens"; // registers the screen words t() reads here

export interface SignupStep1Props {
  /** First and last name, side by side, both required (owner 2026-10-26: names on screen 1). */
  firstName: string;
  setFirstName: (v: string) => void;
  lastName: string;
  setLastName: (v: string) => void;
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
  /** A reason line (e.g. "Create an account to get alerts") in place of the default. */
  subtitle?: string;
  /** The page's security box (<TurnstileField>), placed right above Continue as on Login (A3-C1). */
  captchaSlot?: ReactNode;
  /** The server refused the password (GoTrue weak_password, e.g. a leaked one) after step 2 (AUD31-53): shown under
   *  the field, in place of a toast on another step. The parent clears it when the password changes. */
  serverPasswordError?: string | null;
}


export function SignupStep1({
  firstName,
  setFirstName,
  lastName,
  setLastName,
  email,
  setEmail,
  password,
  setPassword,
  serverPasswordError = null,
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
  subtitle,
  captchaSlot,
}: SignupStep1Props) {
  // The Continue button stays visually active even before the policies box is
  // checked — a disabled grey button is a dead end the user can't learn from.
  // Tapping it while unchecked shakes + highlights the agreement box instead,
  // pointing them at the one thing they still have to do. `nudgeKey` re-mounts
  // the animation so repeated taps replay the shake.
  const { lang, t } = useLanguage();
  const [nudgeKey, setNudgeKey] = useState(0);
  // Set once Continue is tapped — lets the email field surface a "required"
  // error even before the user has typed anything.
  const [attempted, setAttempted] = useState(false);
  // True while a hardware Caps Lock is engaged (web/desktop only; harmless
  // no-op on the iOS soft keyboard, which never reports the modifier).
  const [capsLockOn, setCapsLockOn] = useState(false);

  const firstNameRef = useRef<HTMLInputElement>(null);
  const lastNameRef = useRef<HTMLInputElement>(null);
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
  const passwordError = (password.length > 0 && !passwordValid) || (attempted && !password) || !!serverPasswordError;
  const firstNameError = attempted && !firstName.trim();
  const lastNameError = attempted && !lastName.trim();

  const handleContinue = () => {
    setAttempted(true);
    if (!firstName.trim()) {
      firstNameRef.current?.focus();
      return;
    }
    if (!lastName.trim()) {
      lastNameRef.current?.focus();
      return;
    }
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
  const onFirstNameKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      e.preventDefault();
      lastNameRef.current?.focus();
    }
  };
  const onLastNameKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      e.preventDefault();
      emailRef.current?.focus();
    }
  };
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
        <h1 className="text-page-title text-foreground">{t("signup.title")}</h1>
        <p className="text-ds-14 text-muted-foreground">{subtitle ?? t("signup.subtitle")}</p>
      </div>

      <section className="space-y-3.5">
        {/* First and last name, side by side, both required (owner 2026-10-26,
            final sign-up ask: screen 1 is names, email, password and the Terms
            box; screen 2 is optional). They moved here from step 2. */}
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-2 min-w-0">
            <Label htmlFor="firstName" className={labelCls}>{t("signup.firstName")}</Label>
            <Input ref={firstNameRef} id="firstName" value={firstName} onChange={(e) => setFirstName(e.target.value)} onKeyDown={onFirstNameKeyDown} required aria-required="true" autoComplete="given-name" autoCapitalize="words" enterKeyHint="next" aria-invalid={firstNameError} aria-describedby={firstNameError ? "signup-firstName-error" : undefined}
              className={`${inputCls} ${firstNameError ? "!border-destructive focus-visible:!border-destructive" : ""}`} />
            {firstNameError && (
              <p id="signup-firstName-error" role="alert" className="inline-flex items-center gap-1 text-ds-11 text-[hsl(var(--destructive-ink))]">
                <X className="w-3.5 h-3.5" strokeWidth={2.5} aria-hidden />
                {t("signup.firstNameMissing")}
              </p>
            )}
          </div>
          <div className="space-y-2 min-w-0">
            <Label htmlFor="lastName" className={labelCls}>{t("signup.lastName")}</Label>
            <Input ref={lastNameRef} id="lastName" value={lastName} onChange={(e) => setLastName(e.target.value)} onKeyDown={onLastNameKeyDown} required aria-required="true" autoComplete="family-name" autoCapitalize="words" enterKeyHint="next" aria-invalid={lastNameError} aria-describedby={lastNameError ? "signup-lastName-error" : undefined}
              className={`${inputCls} ${lastNameError ? "!border-destructive focus-visible:!border-destructive" : ""}`} />
            {lastNameError && (
              <p id="signup-lastName-error" role="alert" className="inline-flex items-center gap-1 text-ds-11 text-[hsl(var(--destructive-ink))]">
                <X className="w-3.5 h-3.5" strokeWidth={2.5} aria-hidden />
                {t("signup.lastNameMissing")}
              </p>
            )}
          </div>
        </div>
        <div className="space-y-2">
          {/* Single email field — confirm-email was removed since
              email-verification (the click-the-link step after signup)
              already catches typos. The double field was 2014-era
              friction that costs activations without preventing errors. */}
          <Label htmlFor="email" className={labelCls}>{t("login.email")}</Label>
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
              {email.trim() ? t("login.emailInvalid") : t("login.emailMissing")}
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
                {t("signup.didYouMean")} <span className="font-semibold [overflow-wrap:anywhere]">{emailSuggestion}</span>{t("signup.didYouMeanEnd")}
              </p>
              <div className="flex flex-wrap gap-2">
                <Button type="button" size="sm" variant="outline" className="rounded-full font-semibold" onClick={() => setEmail(emailSuggestion)}>
                  {t("signup.useDomain", { domain: suggestedDomain })}
                </Button>
                <Button type="button" size="sm" variant="outline" className="rounded-full" onClick={() => setKeptEmail(email)}>
                  {t("signup.keepDomain", { domain: typedDomain })}
                </Button>
              </div>
            </div>
          )}
        </div>
        <div className="space-y-2">
          <Label htmlFor="password" className={labelCls}>{t("login.password")}</Label>
          <div className="relative">
            <Input ref={passwordRef} id="password" type={showPassword ? "text" : "password"} enterKeyHint="next" value={password} onChange={(e) => setPassword(e.target.value)} onKeyDown={onPasswordKeyDown} onKeyUp={trackCaps} required minLength={PASSWORD_MIN_LENGTH} aria-invalid={passwordError} aria-describedby={passwordError ? "signup-password-error" : undefined}
              className={`${inputCls} pr-10 ${passwordError ? "!border-destructive focus-visible:!border-destructive" : ""}`} autoComplete="new-password" />
            <button
              type="button"
              onClick={() => setShowPassword(!showPassword)}
              aria-label={showPassword ? t("login.hidePassword") : t("login.showPassword")}
              className="absolute right-0 top-1/2 -translate-y-1/2 w-11 h-11 flex items-center justify-center text-muted-foreground hover:text-foreground transition-colors"
            >
              {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
            </button>
          </div>
          {capsLockOn && (
            <p className="inline-flex items-center gap-1 text-ds-11" style={{ color: "hsl(var(--alert-ink))" }}>
              <ArrowBigUp className="w-3.5 h-3.5" strokeWidth={2} aria-hidden /> {t("signup.capsLock")}
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
              {serverPasswordError ?? (password ? passwordProblem(password) : t("signup.passwordMissing"))}
            </p>
          )}
          {/* The one shared strength meter (also on Reset password). */}
          <PasswordStrengthMeter password={password} />
          {/* No rules list under the password (owner 2026-10-25: "remove the stuff
              under the password ... what's required"): passwordProblem() above names
              exactly what a password still misses, after Continue. */}
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
          {t("signup.agreeLead")}{" "}
          <a href="/terms" target="_blank" rel="noopener noreferrer" onClick={(e) => e.stopPropagation()} className="font-semibold underline text-primary">{t("signup.terms")}</a>,{" "}
          <a href="/rules" target="_blank" rel="noopener noreferrer" onClick={(e) => e.stopPropagation()} className="font-semibold underline text-primary">{t("signup.rules")}</a> {t("signup.and")}{" "}
          <a href="/privacy" target="_blank" rel="noopener noreferrer" onClick={(e) => e.stopPropagation()} className="font-semibold underline text-primary">{t("signup.privacy")}</a>.
          {/* Terms, Rules and Privacy are not translated: a Spanish reader is told they open in English. */}
          {lang === "es" && <span className="block mt-0.5" data-testid="legal-in-english">{t("lang.legalInEnglish")}</span>}
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
          {t("signup.marketing")}
        </span>
      </label>

      {/* Screen-reader parity for the consent gate: the shake is visual only.
          Keyed on nudgeKey so a repeat tap re-announces. */}
      <p key={`consent-alert-${nudgeKey}`} role="alert" className="sr-only">
        {nudgeKey > 0 && !(acceptedPolicies && ageConfirmed)
          ? t("signup.consentNeeded")
          : ""}
      </p>
      </div>

      {/* Continue sits BELOW the consent (Q2256 / audit #44, owner 2026-10-21:
          keep the one combined Terms + 18+ box, read before the action). */}
      {captchaSlot}
      <Button
        variant="primary"
        className="w-full rounded-full"
        size="lg"
        onClick={handleContinue}
      >
        {t("signup.continue")}
      </Button>

      {/* Continue saves the email for ONE reminder if sign-up is not finished
          (owner 2026-10-09; src/lib/signupLead.ts). Said before it happens. */}
      <p className="text-center text-ds-12 font-sans text-muted-foreground">
        {t("signup.mayEmailOnce")}
      </p>

      {SOCIAL_SIGN_IN_ENABLED && (
        <>
          <OrRule />
          <SocialAuthButtons />
        </>
      )}

      <p className="text-center text-ds-12 font-sans" style={{ color: "hsl(var(--olivewood) / 0.8)" }}>
        {t("signup.haveAccount")}{" "}
        <Link to="/login" className="font-semibold hover:underline whitespace-nowrap" style={{ color: "hsl(var(--bark))" }}>
          {t("login.submit")}
        </Link>
      </p>
      <div className="flex justify-center">
        <LanguageToggle />
      </div>
    </div>
  );
}
