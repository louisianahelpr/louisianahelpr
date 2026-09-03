// SignupStep1 — "Create your account" step (UI step 1 of 2).
//
// Extracted from src/pages/Signup.tsx. Owns no state of its own; every
// field is a controlled input bound to props lifted into the parent.
// Validation lives in the parent (validateAccountStep).
//
// Reusable input/label class constants are passed in so the parent stays
// the single source of truth for form styling.

import { useRef, useState, type KeyboardEvent } from "react";
import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { ArrowRight, ArrowBigUp, Eye, EyeOff, Check, Circle, X, Mail, Lock } from "lucide-react";
import { SocialAuthButtons } from "@/components/auth/SocialAuthButtons";
import { suggestEmailCorrection, passwordStrength } from "./signupHelpers";

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
}

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
  const passwordValid = password.length >= 8 && /[A-Z]/.test(password) && /\d/.test(password);
  const emailSuggestion = emailValid ? suggestEmailCorrection(email) : null;
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
      {/* Two columns at lg+, mirroring the Sign in screen (Login.tsx):
          credentials left, social right, with the OR rule as its own middle
          column. Same class strings as Login on purpose — the two auth screens
          are one set, so a value invented here would drift them apart. Stacks
          below lg exactly as before. */}
      <div className="grid gap-6 lg:grid-cols-[1fr_auto_1fr] lg:gap-14 lg:items-stretch">
      {/* The credentials column keeps this step's own `space-y-5` rather than
          Login's form rhythm: the fields, the three consent rows and Continue
          are spaced as they already were — only the column around them is new. */}
      <div className="space-y-5">
      <section className="space-y-5">

        <div className="space-y-2">
          {/* Single email field — confirm-email was removed since
              email-verification (the click-the-link step after signup)
              already catches typos. The double field was 2014-era
              friction that costs activations without preventing errors. */}
          <Label htmlFor="email" className={labelCls}>Email <span aria-hidden style={{ color: "hsl(var(--destructive))" }}>*</span></Label>
          <div className="relative">
            <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 pointer-events-none" style={{ color: "hsl(var(--olivewood) / 0.8)" }} strokeWidth={1.75} />
            <Input ref={emailRef} id="email" type="email" inputMode="email" autoCapitalize="none" autoCorrect="off" spellCheck={false} enterKeyHint="next" value={email} onChange={(e) => setEmail(e.target.value)} onKeyDown={onEmailKeyDown} required autoComplete="email" aria-invalid={emailError} aria-describedby={emailError ? "signup-email-error" : undefined}
              className={`${inputCls} pl-10 ${emailValid ? "pr-10" : ""} ${emailError ? "!border-destructive focus-visible:!border-destructive" : ""}`} />
            {emailValid && (
              <Check className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-primary pointer-events-none" strokeWidth={2.5} aria-hidden />
            )}
          </div>
          {/* No "Email is required" line — the red asterisk on the label and
              the red field border already say it. The FORMAT error is kept:
              a typo'd address is not self-evident from a border alone. */}
          {/* The message accompanies the red border in BOTH failure shapes —
              a malformed address AND an untouched field after Continue. The
              empty case used to paint the border with no words at all, which
              is a "something's wrong" with no path out. */}
          {emailError && (
            <p id="signup-email-error" role="alert" className="inline-flex items-center gap-1 text-ds-11 text-destructive">
              <X className="w-3.5 h-3.5" strokeWidth={2.5} aria-hidden />
              {email.trim() ? "Enter a valid email address" : "Add your email address"}
            </p>
          )}
          {emailSuggestion && (
            <button
              type="button"
              onClick={() => setEmail(emailSuggestion)}
              className="block text-left text-ds-11 font-sans"
              style={{ color: "hsl(var(--bark))" }}
            >
              Did You Mean <span className="font-semibold underline">{emailSuggestion}</span>?
            </button>
          )}
        </div>
        <div className="space-y-2">
          <Label htmlFor="password" className={labelCls}>Password <span aria-hidden style={{ color: "hsl(var(--destructive))" }}>*</span></Label>
          <div className="relative">
            <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 pointer-events-none" style={{ color: "hsl(var(--olivewood) / 0.8)" }} strokeWidth={1.75} />
            <Input ref={passwordRef} id="password" type={showPassword ? "text" : "password"} enterKeyHint="next" value={password} onChange={(e) => setPassword(e.target.value)} onKeyDown={onPasswordKeyDown} onKeyUp={trackCaps} required minLength={8} aria-invalid={passwordError} aria-describedby={passwordError ? "signup-password-error" : undefined}
              className={`${inputCls} pl-10 pr-10 ${passwordError ? "!border-destructive focus-visible:!border-destructive" : ""}`} autoComplete="new-password" />
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
            <p className="inline-flex items-center gap-1 text-ds-11" style={{ color: "hsl(var(--burnt-sienna))" }}>
              <ArrowBigUp className="w-3.5 h-3.5" strokeWidth={2} aria-hidden /> Caps Lock is on
            </p>
          )}
          {attempted && !password && (
            <p id="signup-password-error" role="alert" className="inline-flex items-center gap-1 text-ds-11 text-destructive">
              <X className="w-3.5 h-3.5" strokeWidth={2.5} aria-hidden />
              Add a password
            </p>
          )}
          {password.length > 0 && (() => {
            // Strength meter — a quality nudge that sits above the hard
            // requirement chips. Burnt-sienna for weak/fair, bark for good,
            // green (primary) for strong.
            const { score, label } = passwordStrength(password);
            const barColor =
              score >= 4 ? "hsl(var(--primary))" : score === 3 ? "hsl(var(--bark))" : "hsl(var(--burnt-sienna))";
            return (
              <div className="flex items-center gap-2">
                <div className="flex gap-1 flex-1">
                  {[1, 2, 3, 4].map((i) => (
                    <span
                      key={i}
                      className="h-1 flex-1 rounded-full transition-colors"
                      style={{ background: i <= score ? barColor : "hsl(var(--olivewood) / 0.15)" }}
                    />
                  ))}
                </div>
                <span className="text-ds-11 font-sans w-10 text-right" style={{ color: barColor }}>
                  {label}
                </span>
              </div>
            );
          })()}
          {(() => {
            // Real-time checklist mirrors the validation in Signup.tsx so
            // the user knows exactly what's missing before they tap Continue
            // (previously they'd hit Continue and get a generic toast). Shown
            // from the start (not just once the user types) so the password
            // rules set expectations before the first keystroke.
            const hasLength = password.length >= 8;
            const hasUpper = /[A-Z]/.test(password);
            const hasNumber = /\d/.test(password);
            const Req = ({ ok, label }: { ok: boolean; label: string }) => (
              <span className={`inline-flex items-center gap-1 text-ds-11 ${ok ? "text-primary" : "text-muted-foreground"}`}>
                {ok ? <Check className="w-3 h-3" strokeWidth={2.5} aria-hidden /> : <Circle className="w-3 h-3" strokeWidth={2} aria-hidden />}
                {label}
              </span>
            );
            return (
              <div className="flex flex-wrap gap-x-3 gap-y-1 px-0.5 mt-1">
                <Req ok={hasLength} label="8+ characters" />
                <Req ok={hasUpper} label="Uppercase" />
                <Req ok={hasNumber} label="Number" />
              </div>
            );
          })()}
        </div>
      </section>

      {/* The three consent rows, tightened (owner: "make 3 check boxes tighter
          together"). `space-y-0`, not a smaller one: each row keeps
          `min-h-[44px]` on touch, which is the HIG tap-target minimum and the
          only thing actually setting the row height there — shrinking the rows'
          own `py` would change nothing on a phone because the content centres
          inside that 44px box either way. The gap BETWEEN rows is the one lever
          that doesn't cost a tap target, so that is the one used. On a pointer
          device `[@media(pointer:fine)]:min-h-0` already lets them collapse to
          their content. */}
      <div className="space-y-0 mt-1">
      <label
        key={nudgeKey}
        htmlFor="policies"
        className={`flex items-center gap-3 px-1.5 py-2 min-h-[44px] [@media(pointer:fine)]:min-h-0 rounded-ds-md cursor-pointer transition-colors ${nudgeKey > 0 && !acceptedPolicies ? "animate-attention-nudge" : ""}`}
        style={{
          // Transparent default border keeps the layout stable when the
          // burnt-sienna nudge border appears (no jump on the shake).
          border:
            nudgeKey > 0 && !acceptedPolicies
              ? "1px solid hsl(var(--burnt-sienna) / 0.55)"
              : "1px solid transparent",
        }}
      >
        {/* aria-labelledby, NOT the wrapping <label htmlFor>. Radix renders
            Checkbox as <button role="checkbox"> with empty content, and
            Chrome's accessible-name computation returns nothing for it — the
            accessibility tree showed all three consent boxes as an unnamed
            `checkbox`, so a screen-reader user was agreeing to the Terms while
            hearing only "checkbox, not checked". Pointing at the description
            span names them from the same copy sighted users read, links
            included. */}
        <Checkbox
          id="policies"
          aria-labelledby="policies-label"
          checked={acceptedPolicies}
          onCheckedChange={(checked) => setAcceptedPolicies(checked === true)}
          className="h-5 w-5 mt-[1px] shrink-0 [&_svg]:h-4 [&_svg]:w-4"
        />
        <span
          id="policies-label"
          className="text-ds-11 leading-relaxed font-sans"
          style={{ color: "hsl(var(--olivewood) / 0.8)" }}
        >
          {/* ONE line (owner, 2026-08-22). At text-ds-11 the label column fits
              roughly 48 characters; "I agree to the Terms, Platform Rules, and
              Privacy Policy." is 57 and wrapped, while the age line beside it
              did not — so the three consents read as three different shapes.

              Shortened to 37 by trimming the visible link WORDS only. Every
              destination, and the consent actually recorded, is unchanged.
              "Platform Rules" was also the odd one out: the other three places
              in the app that link /rules call it "Community Rules". */}
          {/* New TAB, not an in-app <Link>. These policies open mid-signup, and
              /signup keeps no draft of the typed email, password, or checkbox
              state — an in-app navigation to /terms therefore threw the form
              away and dropped the user back on an empty step 1. CompleteProfile's
              identical consent row already opens its three policy links in a new
              tab for exactly this reason; this matches it. */}
          I agree to the{" "}
          <a href="/terms" target="_blank" rel="noopener noreferrer" onClick={(e) => e.stopPropagation()} className="font-semibold underline" style={{ color: "hsl(var(--bark))" }}>Terms</a>,{" "}
          <a href="/rules" target="_blank" rel="noopener noreferrer" onClick={(e) => e.stopPropagation()} className="font-semibold underline" style={{ color: "hsl(var(--bark))" }}>Rules</a>{" & "}
          <a href="/privacy" target="_blank" rel="noopener noreferrer" onClick={(e) => e.stopPropagation()} className="font-semibold underline" style={{ color: "hsl(var(--bark))" }}>Privacy</a>
        </span>
      </label>

      {/* 18+ attestation — a HARD requirement (legal age gate), UNCHECKED by
          default. DOB is deferred to first post/apply, so this checkbox is what
          confirms age at account creation. Mirrors the policies box, including
          the shake nudge on a Continue tap while unchecked. */}
      <label
        key={`age-${nudgeKey}`}
        htmlFor="age-confirm"
        className={`flex items-center gap-3 px-1.5 py-2 min-h-[44px] [@media(pointer:fine)]:min-h-0 rounded-ds-md cursor-pointer transition-colors ${nudgeKey > 0 && !ageConfirmed ? "animate-attention-nudge" : ""}`}
        style={{
          border:
            nudgeKey > 0 && !ageConfirmed
              ? "1px solid hsl(var(--burnt-sienna) / 0.55)"
              : "1px solid transparent",
        }}
      >
        <Checkbox
          id="age-confirm"
          aria-labelledby="age-confirm-label"
          checked={ageConfirmed}
          onCheckedChange={(checked) => setAgeConfirmed(checked === true)}
          className="h-5 w-5 mt-[1px] shrink-0 [&_svg]:h-4 [&_svg]:w-4"
        />
        <span
          id="age-confirm-label"
          className="text-ds-11 leading-relaxed font-sans"
          style={{ color: "hsl(var(--olivewood) / 0.8)" }}
        >
          I confirm I am 18 years of age or older.
        </span>
      </label>

      {/* Marketing email opt-in — SEPARATE checkbox, UNCHECKED by default.
          Legal + agreements bundle above is a hard requirement to sign up;
          this second box is optional and persists to profiles.marketing_consent
          so send-marketing-blast can filter recipients honestly. Transactional
          mail (auth, receipts, disputes) is exempt and always sends. */}
      <label
        htmlFor="marketing-consent"
        className="flex items-center gap-3 px-1.5 py-2 min-h-[44px] [@media(pointer:fine)]:min-h-0 rounded-ds-md cursor-pointer"
      >
        <Checkbox
          id="marketing-consent"
          aria-labelledby="marketing-consent-label"
          checked={marketingConsent}
          onCheckedChange={(checked) => setMarketingConsent(checked === true)}
          className="h-5 w-5 mt-[1px] shrink-0 [&_svg]:h-4 [&_svg]:w-4"
        />
        <span
          id="marketing-consent-label"
          className="text-ds-11 leading-relaxed font-sans"
          style={{ color: "hsl(var(--olivewood) / 0.8)" }}
        >
          {/* ONE line, same reason as the policies label above — this was 95
              characters over two lines. "I can unsubscribe any time" is not
              lost: every marketing email carries an unsubscribe link (required
              by CAN-SPAM regardless), and the Privacy Policy linked two rows up
              states it. The checkbox itself stays unchecked by default, which
              is the part that actually has to be true. */}
          Email me occasional Helpr news and offers.
        </span>
      </label>
      </div>

      <Button
        variant="primary"
        className="w-full rounded-ds-md"
        size="lg"
        onClick={handleContinue}
      >
        Continue <ArrowRight className="w-4 h-4 ml-1" />
      </Button>
      </div>

      {/* Vertical OR rule, lg+ only — the horizontal one inside the right
          column still handles the stacked layout below lg. Its own grid
          column so it sits between the two methods rather than inside
          either. */}
      <div className="hidden lg:flex flex-col items-center gap-3" aria-hidden>
        <span className="w-px flex-1" style={{ backgroundColor: "hsl(var(--olivewood) / 0.14)" }} />
        <span
          className="text-ds-11 tracking-[0.2em] uppercase font-serif italic"
          style={{ color: "hsl(var(--accent-ink) / 0.9)" }}
        >
          or
        </span>
        <span className="w-px flex-1" style={{ backgroundColor: "hsl(var(--olivewood) / 0.14)" }} />
      </div>

      {/* Vertically centred against the taller credentials column, so the
          social buttons sit level with the form rather than hugging the top
          with dead space beneath them. */}
      <div className="space-y-6 lg:flex lg:flex-col lg:justify-center lg:gap-8 lg:space-y-0">
      {/* The OR rule only makes sense when the two methods are stacked. At
          lg+ they sit side by side, so the columns themselves do the
          separating. */}
      <div className="flex items-center gap-3 lg:hidden">
        <span className="h-px flex-1" style={{ backgroundColor: "hsl(var(--olivewood) / 0.14)" }} />
        <span
          className="text-ds-11 tracking-[0.2em] uppercase font-serif italic"
          style={{ color: "hsl(var(--accent-ink) / 0.9)" }}
        >
          or
        </span>
        <span className="h-px flex-1" style={{ backgroundColor: "hsl(var(--olivewood) / 0.14)" }} />
      </div>

      <SocialAuthButtons mode="signup" />

      {/* Signing in is the alternative to BOTH create-account methods, so it
          closes the social column — the mirror of Login's "New to Helpr?".
          It used to render from Signup.tsx after this component, guarded by
          `step === 1`; living inside SignupStep1 makes that guard structural
          (step 2 never mounts this file) instead of a condition someone has to
          remember. No `mt-5` any more: it was already dead under the card's
          `space-y-6`, and at lg+ — where `lg:space-y-0` zeroes that out — it
          would have become a live 20px on top of `lg:gap-8`. */}
      <p className="text-center text-ds-11 font-sans" style={{ color: "hsl(var(--olivewood) / 0.8)" }}>
        Already have an account?{" "}
        <Link
          to="/login"
          className="font-semibold hover:underline whitespace-nowrap"
          style={{ color: "hsl(var(--bark))" }}
        >
          Log In
        </Link>
      </p>
      </div>
      </div>

    </div>
  );
}
