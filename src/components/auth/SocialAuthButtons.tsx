// SocialAuthButtons — the single block of "Continue with Apple /
// Continue with Google" buttons used on both /login and /signup.
//
// Drives all branching through signInWithProvider in src/lib/socialAuth.ts
// so the per-provider flow stays in one place. The buttons themselves
// only know:
//   - render the provider mark + its name, side by side (the FULL accessible
//     name — "Sign in with Apple" — stays on aria-label)
//   - keep a spinner while sign-in is in flight
//   - on cancel → hapticError + dismissable toast (no scary copy)
//   - on success (native) → navigate to redirectTo (default /dashboard)
//   - on redirecting (web OAuth) → keep spinner up, the browser is about
//     to leave the page anyway
//   - on error → hapticError + toast with friendly copy
//
// Apple HIG requires Apple to appear above (or at least equally prominent
// to) any other third-party sign-in option, so Apple renders first.
import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { hapticError } from "@/lib/haptics";
import {
  signInWithProvider,
  type SocialProvider,
  type SocialSignInResult,
} from "@/lib/socialAuth";
import { userFacingError } from "@/lib/userFacingError";

type SocialAuthLabelMode = "signin" | "signup";

interface SocialAuthButtonsProps {
  // Label mode — "signin" → "Sign in with Apple", "signup" → "Sign up with Apple".
  mode?: SocialAuthLabelMode;
  // Where to navigate after a successful native sign-in. Defaults to /dashboard.
  redirectTo?: string;
}

export function SocialAuthButtons({
  mode = "signin",
  redirectTo,
}: SocialAuthButtonsProps) {
  return (
    // Two marks side by side, not two stacked full-width labelled boxes
    // (owner: "I would prefer using the Apple and Google icons instead of the
    // 2 large boxes"). The boxes said "Sign in with Apple" / "Sign in with
    // Google" directly under an "or" divider that had already established
    // what this is, and took roughly a third of the auth column to do it.
    //
    // The accessible name is unchanged — it lives on each button's
    // `aria-label`, which already carried the full "Sign in with Apple"
    // string, so a screen reader hears exactly what it heard before.
    //
    // Apple renders FIRST (left). Apple's HIG asks that Sign in with Apple be
    // at least as prominent as any other third-party option; equal-size
    // buttons with Apple leading satisfies that.
    // STACKED, one provider per full-width row, each showing its mark AND its
    // word. Settled 2026-08-22 — do not flip this again without reading the
    // history, because it has now been changed three times:
    //
    //   1. side-by-side, icons only  → objection: "a bare icon in a half-width
    //      box" (the box was sized for a label it did not have)
    //   2. stacked, icons only       → the box got smaller but the icon was
    //      still unlabelled
    //   3. side-by-side, labelled    → fixed the label, reopened (1)'s layout
    //   4. STACKED, labelled         ← here. Both halves of the objection are
    //      answered: every button has a word, and no button is a wide box with
    //      a small mark adrift in it.
    //
    // The ~59pt a two-column row would save is real, and it is not worth
    // reopening a question that has already cost four passes.
    //
    // Apple renders FIRST (top). Apple's HIG asks that Sign in with Apple be at
    // least as prominent as any other third-party option; identical full-width
    // rows with Apple leading satisfies that.
    <div className="flex flex-col gap-8">
      <SocialAuthButton provider="apple" mode={mode} redirectTo={redirectTo} />
      <SocialAuthButton provider="google" mode={mode} redirectTo={redirectTo} />
    </div>
  );
}

interface SocialAuthButtonProps {
  provider: SocialProvider;
  mode: SocialAuthLabelMode;
  redirectTo?: string;
}

function SocialAuthButton({ provider, mode, redirectTo }: SocialAuthButtonProps) {
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();

  const verb = mode === "signup" ? "Sign up" : "Sign in";
  const providerName = provider === "apple" ? "Apple" : "Google";
  const label = `${verb} with ${providerName}`;

  const handleClick = async () => {
    setLoading(true);
    const result: SocialSignInResult = await signInWithProvider(provider, { redirectTo });

    switch (result.kind) {
      case "success": {
        // Navigate to the post-sign-in landing. The SPA's new-user-routing
        // guard will redirect to /complete-profile for first-time users.
        const target = redirectTo
          ? new URL(redirectTo, window.location.origin).pathname
          : "/dashboard";
        navigate(target, { replace: true });
        return;
      }
      case "redirecting":
        // Browser is leaving the page — keep the spinner up so the user
        // doesn't tap twice. No setLoading(false).
        return;
      case "cancelled":
        // Per memory rule "warm copy + hapticError on secondary error
        // toasts" — even a cancel deserves a small haptic so the user
        // knows the tap registered.
        hapticError();
        // Stable id collapses any repeat into a single toast — the native
        // Apple/Google flow can resolve more than once (plugin reject +
        // redirect listener), which otherwise stacked identical toasts.
        toast(`${providerName} sign-in cancelled.`, { id: `social-auth-${provider}` });
        setLoading(false);
        return;
      case "error":
        hapticError();
        toast.error(userFacingError(result, `Couldn't sign in with ${provider} — try again?`), { id: `social-auth-${provider}` });
        setLoading(false);
        return;
    }
  };

  return (
    <Button
      type="button"
      variant="outline"
      size="lg"
      // w-full inside a half-width grid cell. h-12 keeps the 44pt minimum
      // target with room to spare.
      className="w-full h-12 rounded-ds-md border-border/70 hover:bg-muted/40 gap-2"
      onClick={handleClick}
      disabled={loading}
      // Still carries the FULL label ("Sign in with Apple"), not just the
      // provider word rendered beside the mark — a screen reader hears the
      // whole action, a sighted user reads the short form.
      aria-label={loading ? "Connecting…" : label}
      title={label}
    >
      {loading ? (
        <Loader2 className="w-5 h-5 animate-spin" />
      ) : (
        <>
          {provider === "apple" ? <AppleMark /> : <GoogleMark />}
          {/* The visible word. Its absence is the whole reason this block was
              stacked into full-width rows — an unlabelled icon in a box wide
              enough for text reads as a rendering failure. aria-hidden because
              the button's aria-label already names the action in full; without
              it a screen reader would announce "Sign in with Apple, Apple". */}
          <span aria-hidden className="font-sans font-medium text-ds-14">
            {provider === "apple" ? "Apple" : "Google"}
          </span>
        </>
      )}
    </Button>
  );
}

function AppleMark() {
  return (
    <svg
      className="w-5 h-5"
      viewBox="0 0 24 24"
      fill="currentColor"
      aria-hidden="true"
    >
      <path d="M17.05 12.04c-.03-2.93 2.39-4.34 2.5-4.41-1.36-1.99-3.48-2.27-4.24-2.3-1.81-.18-3.53 1.06-4.45 1.06-.92 0-2.34-1.03-3.85-1-1.98.03-3.81 1.15-4.83 2.92-2.06 3.57-.53 8.85 1.48 11.75.98 1.42 2.15 3.02 3.69 2.96 1.48-.06 2.04-.96 3.83-.96 1.79 0 2.29.96 3.86.93 1.59-.03 2.6-1.45 3.57-2.88 1.13-1.65 1.59-3.25 1.62-3.33-.04-.02-3.11-1.19-3.14-4.74zM14.13 3.5c.81-.99 1.36-2.36 1.21-3.72-1.17.05-2.59.78-3.43 1.76-.75.87-1.41 2.27-1.23 3.6 1.31.1 2.64-.66 3.45-1.64z" />
    </svg>
  );
}

function GoogleMark() {
  return (
    <svg className="w-5 h-5" viewBox="0 0 24 24" aria-hidden="true">
      <path
        fill="#4285F4"
        d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
      />
      <path
        fill="#34A853"
        d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
      />
      <path
        fill="#FBBC05"
        d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
      />
      <path
        fill="#EA4335"
        d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
      />
    </svg>
  );
}
