// SignupStep1 — "Create your account" step (UI step 1 of 3).
//
// Extracted from src/pages/Signup.tsx. Owns no state of its own; every
// field is a controlled input bound to props lifted into the parent.
// Validation lives in the parent (validateAccountStep).
//
// Reusable input/label class constants are passed in so the parent stays
// the single source of truth for form styling.

import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { ArrowRight, Eye, EyeOff, Check, Circle, X, Mail, Lock, Building2 } from "lucide-react";
import { GoogleSignInButton } from "@/components/auth/GoogleSignInButton";
import { AppleSignInButton } from "@/components/auth/AppleSignInButton";

export interface SignupStep1Props {
  email: string;
  setEmail: (v: string) => void;
  password: string;
  setPassword: (v: string) => void;
  confirmPassword: string;
  setConfirmPassword: (v: string) => void;
  showPassword: boolean;
  setShowPassword: (v: boolean) => void;
  showConfirmPassword: boolean;
  setShowConfirmPassword: (v: boolean) => void;
  acceptedPolicies: boolean;
  setAcceptedPolicies: (v: boolean) => void;
  inputCls: string;
  labelCls: string;
  /** True when the URL carries ?type=business — drives the account-type toggle. */
  isBusinessSignup: boolean;
  /** Called when the user clicks Continue — parent runs validation, then advances step. */
  onContinue: () => void | Promise<void>;
}

export function SignupStep1({
  email,
  setEmail,
  password,
  setPassword,
  confirmPassword,
  setConfirmPassword,
  showPassword,
  setShowPassword,
  showConfirmPassword,
  setShowConfirmPassword,
  acceptedPolicies,
  setAcceptedPolicies,
  inputCls,
  labelCls,
  isBusinessSignup,
  onContinue,
}: SignupStep1Props) {
  return (
    <div className="space-y-5">
      {/* Business-mode banner — when ?type=business is set, confirm the user
          is on the company path (and give them an escape hatch back to
          personal). The everyday entry point is the quiet footer link below,
          not an up-front toggle. */}
      {isBusinessSignup && (
        <div
          className="flex items-start gap-3 px-4 py-3 rounded-2xl"
          style={{ background: "hsl(var(--bark) / 0.06)", border: "1px solid hsl(var(--bark) / 0.16)" }}
        >
          <Building2 className="w-5 h-5 shrink-0 mt-0.5" strokeWidth={1.75} style={{ color: "hsl(var(--bark))" }} />
          <div className="space-y-0.5">
            <p className="text-ds-13 font-sans font-semibold" style={{ color: "hsl(var(--ink-deep))" }}>
              Business account
            </p>
            <p className="text-ds-11 font-sans" style={{ color: "hsl(var(--olivewood) / 0.8)" }}>
              Invite your team and bill jobs to one card.{" "}
              <Link to="/signup" replace className="font-semibold underline" style={{ color: "hsl(var(--bark))" }}>
                Personal instead?
              </Link>
            </p>
          </div>
        </div>
      )}

      <section className="space-y-3">
        <div className="space-y-2">
          {/* Single email field — confirm-email was removed since
              email-verification (the click-the-link step after signup)
              already catches typos. The double field was 2014-era
              friction that costs activations without preventing errors. */}
          <Label htmlFor="email" className={labelCls}>Email <span className="text-destructive">*</span></Label>
          <div className="relative">
            <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 pointer-events-none" style={{ color: "hsl(var(--olivewood) / 0.5)" }} strokeWidth={1.75} />
            <Input id="email" type="email" inputMode="email" autoCapitalize="none" autoCorrect="off" spellCheck={false} placeholder="you@example.com" value={email} onChange={(e) => setEmail(e.target.value)} required autoComplete="email" className={`${inputCls} pl-10`} />
          </div>
        </div>
        <div className="space-y-2">
          <Label htmlFor="password" className={labelCls}>Password <span className="text-destructive">*</span></Label>
          <div className="relative">
            <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 pointer-events-none" style={{ color: "hsl(var(--olivewood) / 0.5)" }} strokeWidth={1.75} />
            <Input id="password" type={showPassword ? "text" : "password"} placeholder="Create a password" value={password} onChange={(e) => setPassword(e.target.value)} required minLength={8} className={`${inputCls} pl-10 pr-10`} autoComplete="new-password" />
            <button
              type="button"
              onClick={() => setShowPassword(!showPassword)}
              aria-label={showPassword ? "Hide password" : "Show password"}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
            >
              {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
            </button>
          </div>
          {password.length > 0 && (() => {
            // Real-time checklist mirrors the validation in Signup.tsx so
            // the user knows exactly what's missing before they tap Continue
            // (previously they'd hit Continue and get a generic toast).
            const hasLength = password.length >= 8;
            const hasUpper = /[A-Z]/.test(password);
            const hasNumber = /\d/.test(password);
            const Req = ({ ok, label }: { ok: boolean; label: string }) => (
              <span className={`inline-flex items-center gap-1 text-ds-11 ${ok ? "text-primary" : "text-muted-foreground"}`}>
                {ok ? <Check className="w-3.5 h-3.5" strokeWidth={2.5} aria-hidden /> : <Circle className="w-3.5 h-3.5" strokeWidth={2} aria-hidden />}
                {label}
              </span>
            );
            return (
              <div className="flex flex-wrap gap-x-3 gap-y-1 px-0.5 mt-1">
                <Req ok={hasLength} label="8+ chars" />
                <Req ok={hasUpper} label="Uppercase" />
                <Req ok={hasNumber} label="Number" />
              </div>
            );
          })()}
        </div>
        <div className="space-y-2">
          <Label htmlFor="confirmPassword" className={labelCls}>Confirm password <span className="text-destructive">*</span></Label>
          <div className="relative">
            <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 pointer-events-none" style={{ color: "hsl(var(--olivewood) / 0.5)" }} strokeWidth={1.75} />
            <Input id="confirmPassword" type={showConfirmPassword ? "text" : "password"} placeholder="Re-enter your password" value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)} required minLength={8} className={`${inputCls} pl-10 ${confirmPassword && password === confirmPassword ? "pr-16" : "pr-10"}`} autoComplete="new-password" />
            {confirmPassword && password === confirmPassword && (
              <Check className="absolute right-9 top-1/2 -translate-y-1/2 w-4 h-4 text-primary pointer-events-none" strokeWidth={2.5} aria-hidden />
            )}
            <button
              type="button"
              onClick={() => setShowConfirmPassword(!showConfirmPassword)}
              aria-label={showConfirmPassword ? "Hide confirm password" : "Show confirm password"}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
            >
              {showConfirmPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
            </button>
          </div>
          {confirmPassword && (
            <p className={`inline-flex items-center gap-1 text-ds-11 ${password === confirmPassword ? "text-primary" : "text-destructive"}`}>
              {password === confirmPassword
                ? <><Check className="w-3.5 h-3.5" strokeWidth={2.5} aria-hidden /> Passwords match</>
                : <><X className="w-3.5 h-3.5" strokeWidth={2.5} aria-hidden /> Passwords do not match</>}
            </p>
          )}
        </div>
      </section>

      <label
        htmlFor="policies"
        className="flex items-start gap-3 px-3 py-3 rounded-ds-md cursor-pointer hover:bg-white/30 transition-colors"
        style={{ border: "1px solid hsl(var(--olivewood) / 0.12)" }}
      >
        <Checkbox
          id="policies"
          checked={acceptedPolicies}
          onCheckedChange={(checked) => setAcceptedPolicies(checked === true)}
          className="h-5 w-5 mt-[1px] shrink-0 [&_svg]:h-4 [&_svg]:w-4"
        />
        <span
          className="text-ds-11 leading-relaxed font-sans"
          style={{ color: "hsl(var(--olivewood) / 0.78)" }}
        >
          I agree to the{" "}
          <Link to="/rules" target="_blank" className="font-semibold hover:underline" style={{ color: "hsl(var(--bark))" }}>Platform Rules</Link>,{" "}
          <Link to="/terms" target="_blank" className="font-semibold hover:underline" style={{ color: "hsl(var(--bark))" }}>Terms of Service</Link>, and{" "}
          <Link to="/privacy" target="_blank" className="font-semibold hover:underline" style={{ color: "hsl(var(--bark))" }}>Privacy Policy</Link>.
          I understand the cancellation, no-show, and dispute policies.
        </span>
      </label>

      <Button
        variant="bark"
        className="w-full rounded-ds-md"
        size="lg"
        onClick={onContinue}
        disabled={!acceptedPolicies}
      >
        Continue <ArrowRight className="w-4 h-4 ml-1" />
      </Button>
      {!acceptedPolicies && (
        <p className="text-ds-11 text-center text-muted-foreground -mt-2">
          Check the box above to continue.
        </p>
      )}

      <div className="relative">
        <div className="absolute inset-0 flex items-center">
          <span className="w-full border-t border-border/60" />
        </div>
        <div className="relative flex justify-center text-ds-11 uppercase">
          {/* The OR divider sits on the `.bg-card` glass surface, which is
              promoted to a semi-transparent fill globally (see index.css
              `:where(.bg-card)`). `text-muted-foreground` (stormy-sky)
              against that translucent paint falls below WCAG AA 4.5:1
              — axe-core flags this as the only `color-contrast` violation
              on /signup. Bump to `text-foreground` (olivewood) which sits
              comfortably above the threshold while still reading as
              quiet "divider" type. */}
          <span className="bg-card px-2 text-foreground/80">or</span>
        </div>
      </div>

      <div className="space-y-2">
        <GoogleSignInButton label="Sign up with Google" />
        <AppleSignInButton label="Sign up with Apple" />
      </div>

      {/* Quiet business escape hatch — the everyday way a company owner finds
          the business path, without forcing every visitor through an up-front
          Personal/Business choice. Hidden in business mode (the banner above
          already offers the reverse switch). Same-route ?type= flip keeps the
          parent form mounted, so typed email/password survive the switch. */}
      {!isBusinessSignup && (
        <p className="text-center text-ds-11 font-sans" style={{ color: "hsl(var(--olivewood) / 0.7)" }}>
          Setting up for a company?{" "}
          <Link to="/signup?type=business" replace className="font-semibold hover:underline" style={{ color: "hsl(var(--bark))" }}>
            Switch to business sign-up
          </Link>
        </p>
      )}
    </div>
  );
}
