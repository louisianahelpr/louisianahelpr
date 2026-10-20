import { useState } from "react";
import { Apple } from "lucide-react";
import { toast } from "sonner";
import { SOCIAL_SIGN_IN_ENABLED, signInWithProvider } from "@/lib/socialAuth";
import { report } from "@/lib/errorLogger";

/**
 * The landing's "Continue with Apple" (lead, LANDING-APPROVED.md: only while
 * Apple sign-in is on for the web). Loaded lazily by the join block once it is
 * on screen, so socialAuth (and Supabase) never join the landing's first paint.
 *
 * Behind the one switch every social entry point reads (SOCIAL_SIGN_IN_ENABLED,
 * guard src/test/socialSignInOff.test.ts): off, it renders nothing. On the web
 * the provider call leaves the page for Apple ("redirecting"); the return lands
 * on Login, which asks the one-account question if it is needed (Q446). Any
 * other outcome says so and sends the visitor to the full sign-up page, never a
 * dead tap.
 */
export default function LandingAppleButton() {
  const [busy, setBusy] = useState(false);
  if (!SOCIAL_SIGN_IN_ENABLED) return null;
  const go = async () => {
    setBusy(true);
    try {
      const result = await signInWithProvider("apple", { redirectTo: "/home" });
      if (result.kind === "redirecting" || result.kind === "success") return;
      setBusy(false);
      if (result.kind !== "cancelled") {
        toast.error("Apple sign-in didn't finish. Try again, or create an account with your email.", { id: "landing-apple" });
      }
    } catch (error) {
      report(error, { severity: "warning", tags: { source: "landing.appleSignIn" } });
      setBusy(false);
      toast.error("Apple sign-in didn't finish. Try again, or create an account with your email.", { id: "landing-apple" });
    }
  };
  return (
    <button
      type="button"
      onClick={() => void go()}
      disabled={busy}
      aria-busy={busy}
      className="inline-flex items-center justify-center gap-2 h-14 w-full sm:w-auto px-7 rounded-full text-ds-15 font-semibold transition-colors disabled:opacity-60"
      style={{ background: "var(--lp-surface)", border: "1px solid var(--lp-line-strong)", color: "var(--lp-ink)" }}
      data-testid="landing-apple"
    >
      <Apple className="w-[18px] h-[18px]" strokeWidth={1.5} fill="currentColor" aria-hidden />
      Continue with Apple
    </button>
  );
}
