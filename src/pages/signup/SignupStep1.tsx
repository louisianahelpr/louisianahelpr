// SignupStep1 — "Create your account" step (UI step 1 of 3).
//
// Extracted from src/pages/Signup.tsx. Owns no state of its own; every
// field is a controlled input bound to props lifted into the parent.
// Validation lives in the parent (validateStep2 — yes the legacy naming
// is inverted; cleaning that up is a separate cut).
//
// Reusable input/label class constants are passed in so the parent stays
// the single source of truth for form styling.

import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { ArrowRight, Eye, EyeOff } from "lucide-react";
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
  onContinue,
}: SignupStep1Props) {
  return (
    <div className="space-y-6">
      <section className="space-y-3">
        <div className="space-y-2">
          {/* Single email field — confirm-email was removed since
              email-verification (the click-the-link step after signup)
              already catches typos. The double field was 2014-era
              friction that costs activations without preventing errors. */}
          <Label htmlFor="email" className={labelCls}>Email <span className="text-destructive">*</span></Label>
          <Input id="email" type="email" inputMode="email" autoCapitalize="none" autoCorrect="off" spellCheck={false} placeholder="you@example.com" value={email} onChange={(e) => setEmail(e.target.value)} required autoComplete="email" className={inputCls} />
        </div>
        <div className="space-y-2">
          <Label htmlFor="password" className={labelCls}>Password <span className="text-destructive">*</span></Label>
          <div className="relative">
            <Input id="password" type={showPassword ? "text" : "password"} placeholder="At least 8 characters, 1 uppercase, 1 number" value={password} onChange={(e) => setPassword(e.target.value)} required minLength={8} className={`${inputCls} pr-10`} autoComplete="new-password" />
            <button
              type="button"
              onClick={() => setShowPassword(!showPassword)}
              aria-label={showPassword ? "Hide password" : "Show password"}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
            >
              {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
            </button>
          </div>
        </div>
        <div className="space-y-2">
          <Label htmlFor="confirmPassword" className={labelCls}>Confirm password <span className="text-destructive">*</span></Label>
          <div className="relative">
            <Input id="confirmPassword" type={showConfirmPassword ? "text" : "password"} placeholder="Re-enter your password" value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)} required minLength={8} className={`${inputCls} pr-10`} autoComplete="new-password" />
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
            <p className={`text-xs ${password === confirmPassword ? "text-primary" : "text-destructive"}`}>
              {password === confirmPassword ? "✓ Passwords match" : "✗ Passwords do not match"}
            </p>
          )}
        </div>
      </section>

      <div className="flex items-start gap-2.5 px-1">
        <Checkbox
          id="policies"
          checked={acceptedPolicies}
          onCheckedChange={(checked) => setAcceptedPolicies(checked === true)}
          className="h-3.5 w-3.5 mt-[3px] [&_svg]:h-3 [&_svg]:w-3"
        />
        <label
          htmlFor="policies"
          className="text-xs leading-relaxed cursor-pointer font-sans"
          style={{ color: "hsl(var(--olivewood) / 0.75)" }}
        >
          I agree to the{" "}
          <Link to="/rules" target="_blank" className="font-semibold hover:underline" style={{ color: "hsl(var(--bark))" }}>Platform Rules</Link>,{" "}
          <Link to="/terms" target="_blank" className="font-semibold hover:underline" style={{ color: "hsl(var(--bark))" }}>Terms of Service</Link>, and{" "}
          <Link to="/privacy" target="_blank" className="font-semibold hover:underline" style={{ color: "hsl(var(--bark))" }}>Privacy Policy</Link>.
          I understand the cancellation, no-show, and dispute policies.
        </label>
      </div>

      <Button
        className="w-full"
        size="lg"
        onClick={onContinue}
        disabled={!acceptedPolicies}
      >
        Continue <ArrowRight className="w-4 h-4 ml-1" />
      </Button>

      <div className="relative">
        <div className="absolute inset-0 flex items-center">
          <span className="w-full border-t border-border/60" />
        </div>
        <div className="relative flex justify-center text-xs uppercase">
          <span className="bg-card px-2 text-muted-foreground">or</span>
        </div>
      </div>

      <div className="space-y-2">
        <GoogleSignInButton label="Sign up with Google" />
        <AppleSignInButton label="Sign up with Apple" />
      </div>
    </div>
  );
}
