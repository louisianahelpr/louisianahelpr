import { Button } from "@/components/ui/button";
import { Loader2 } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { Capacitor } from "@capacitor/core";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { nativeAppleSignIn } from "@/lib/socialLogin";

interface AppleSignInButtonProps {
  label?: string;
  redirectTo?: string;
}

// Apple sign-in. On native iOS uses Apple's ASAuthorization framework
// via @capgo/capacitor-social-login + signInWithIdToken (no browser
// round-trip). On web uses Supabase OAuth (browser redirects to Apple).
export const AppleSignInButton = ({
  label = "Continue with Apple",
  redirectTo,
}: AppleSignInButtonProps) => {
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();

  const handleClick = async () => {
    setLoading(true);

    if (Capacitor.isNativePlatform()) {
      try {
        await nativeAppleSignIn();
        // Session is now live. Mirror the post-OAuth landing logic:
        // navigate to /dashboard (or the redirectTo if explicit).
        // SPA new-user routing handler will redirect to /complete-profile
        // for first-time users.
        navigate(redirectTo ? new URL(redirectTo, window.location.origin).pathname : "/dashboard");
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Apple sign-in failed.");
        setLoading(false);
      }
      return;
    }

    try {
      const { error } = await supabase.auth.signInWithOAuth({
        provider: "apple",
        options: {
          redirectTo: redirectTo ?? `${window.location.origin}/dashboard`,
        },
      });

      if (error) {
        toast.error(error.message ?? "Apple sign-in failed. Please try again.");
        setLoading(false);
        return;
      }
      // Browser redirects to Apple's auth page. Keep spinner up.
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Apple sign-in failed.");
      setLoading(false);
    }
  };

  return (
    <Button
      type="button"
      variant="outline"
      size="lg"
      className="w-full rounded-xl border-border/70 bg-foreground text-background hover:bg-foreground/90 hover:text-background"
      onClick={handleClick}
      disabled={loading}
    >
      {loading ? (
        <Loader2 className="w-4 h-4 mr-2 animate-spin" />
      ) : (
        <svg className="w-4 h-4 mr-2" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
          <path d="M17.05 12.04c-.03-2.93 2.39-4.34 2.5-4.41-1.36-1.99-3.48-2.27-4.24-2.3-1.81-.18-3.53 1.06-4.45 1.06-.92 0-2.34-1.03-3.85-1-1.98.03-3.81 1.15-4.83 2.92-2.06 3.57-.53 8.85 1.48 11.75.98 1.42 2.15 3.02 3.69 2.96 1.48-.06 2.04-.96 3.83-.96 1.79 0 2.29.96 3.86.93 1.59-.03 2.6-1.45 3.57-2.88 1.13-1.65 1.59-3.25 1.62-3.33-.04-.02-3.11-1.19-3.14-4.74zM14.13 3.5c.81-.99 1.36-2.36 1.21-3.72-1.17.05-2.59.78-3.43 1.76-.75.87-1.41 2.27-1.23 3.6 1.31.1 2.64-.66 3.45-1.64z" />
        </svg>
      )}
      {loading ? "Connecting…" : label}
    </Button>
  );
};
