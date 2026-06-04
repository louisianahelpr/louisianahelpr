import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Loader2, Eye, EyeOff } from "lucide-react";
import { usePageMeta } from "@/hooks/usePageMeta";
import { useQueryClient } from "@tanstack/react-query";
import { GoogleSignInButton } from "@/components/auth/GoogleSignInButton";
import { AppleSignInButton } from "@/components/auth/AppleSignInButton";
import AuthShell from "@/components/auth/AuthShell";
import HelprMark from "@/components/HelprMark";
import { hapticMedium, hapticSuccess, hapticError } from "@/lib/haptics";
import BuildStamp from "@/components/BuildStamp";
import { queryKeys } from "@/lib/queryKeys";

const LOGIN_TIMEOUT_MS = 15000;

const signInWithTimeout = async (email: string, password: string) => {
  let timeoutId: number | undefined;
  try {
    return await Promise.race([
      supabase.auth.signInWithPassword({ email, password }),
      new Promise<never>((_, reject) => {
        timeoutId = window.setTimeout(() => reject(new Error("Login timed out. Please check your connection and try again.")), LOGIN_TIMEOUT_MS);
      }),
    ]);
  } finally {
    if (timeoutId) window.clearTimeout(timeoutId);
  }
};

const Login = () => {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  usePageMeta({
    title: "Log In — Helpr",
    description: "Sign in to your Helpr account.",
    canonical: "https://www.louisianahelpr.com/login",
    ogTitle: "Log In — Helpr",
    ogDescription: "Sign in to your Helpr account to post tasks or pick up local work across Louisiana.",
  });
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [loginAttempts, setLoginAttempts] = useState(0);
  const [lockedUntil, setLockedUntil] = useState<number | null>(null);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();

    if (lockedUntil && Date.now() < lockedUntil) {
      const secondsLeft = Math.ceil((lockedUntil - Date.now()) / 1000);
      hapticError();
      toast.error(`Too many attempts. Try again in ${secondsLeft}s`);
      return;
    }

    hapticMedium();
    setLoading(true);
    const { data, error } = await signInWithTimeout(email, password).catch((error: Error) => ({ data: { session: null }, error }));
    if (error) {
      setLoading(false);
      const newAttempts = loginAttempts + 1;
      setLoginAttempts(newAttempts);
      hapticError();
      if (newAttempts >= 5) {
        setLockedUntil(Date.now() + 60000);
        setLoginAttempts(0);
        toast.error("Too many failed attempts. Account locked for 60 seconds.");
      } else {
        toast.error(error.message);
      }
      return;
    }
    setLoginAttempts(0);

    const sessionUser = data.session?.user;
    if (sessionUser && !sessionUser.email_confirmed_at) {
      await supabase.auth.signOut();
      setLoading(false);
      hapticError();
      toast.error("Please verify your email before logging in. Check your inbox for a verification link.");
      return;
    }

    void queryClient.invalidateQueries({ queryKey: queryKeys.currentUser.all });
    setLoading(false);
    hapticSuccess();
    // Personalized greeting — fetch the user's first name for a warmer
    // welcome. Falls back to plain "Welcome back" if the profile isn't
    // accessible yet (race window during signup confirmation).
    let firstName = "";
    try {
      const userId = data.session?.user?.id;
      if (userId) {
        const { data: prof } = await supabase
          .from("profiles")
          .select("full_name")
          .eq("user_id", userId)
          .maybeSingle();
        firstName = (prof?.full_name ?? "").trim().split(/\s+/)[0] ?? "";
      }
    } catch { /* fall through to generic copy */ }
    toast.success(firstName ? `Welcome back, ${firstName}.` : "Welcome back.");
    navigate("/dashboard", { replace: true });
  };

  return (
    <AuthShell hideHeader>
      <div className="text-center mb-5 space-y-2">
        <div className="flex justify-center mb-6">
          <HelprMark to={null} size="lg" emblemOnly />
        </div>
        <h1
          className="font-display italic font-bold leading-tight"
          style={{
            fontSize: "clamp(1.85rem, 3vw + 0.5rem, 2.5rem)",
            color: "hsl(var(--ink-deep))",
            letterSpacing: "-0.03em",
          }}
        >
          Glad you're back.
        </h1>
        <p
          className="font-sans"
          style={{
            fontSize: "0.95rem",
            color: "hsl(var(--olivewood) / 0.7)",
            letterSpacing: "0.01em",
          }}
        >
          Pick up right where you left off.
        </p>
      </div>

      <div className="liquid-glass px-6 sm:px-8 py-6 sm:py-7 space-y-5">
        <form onSubmit={handleLogin} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="email" className="text-ds-13 font-sans font-medium">Email</Label>
            <Input
              id="email"
              type="email"
              inputMode="email"
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              placeholder="you@example.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              autoComplete="email"
              className="rounded-ds-md bg-white/60 dark:bg-white/5 border-[hsl(var(--bark)/0.28)] dark:border-white/15 shadow-[inset_0_1px_2px_hsl(var(--ink-deep)/0.05)]"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="password" className="text-ds-13 font-sans font-medium">Password</Label>
            <div className="relative">
              <Input
                id="password"
                type={showPassword ? "text" : "password"}
                placeholder="Your password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                autoComplete="current-password"
                className="pr-10 rounded-ds-md bg-white/60 dark:bg-white/5 border-[hsl(var(--bark)/0.28)] dark:border-white/15 shadow-[inset_0_1px_2px_hsl(var(--ink-deep)/0.05)]"
              />
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
          <div className="flex items-center justify-between">
            <Link
              to="/forgot-password"
              className="text-ds-11 font-sans tracking-wide hover:opacity-70 active:opacity-50 transition-opacity"
              style={{ color: "hsl(var(--olivewood) / 0.75)" }}
            >
              Forgot password?
            </Link>
          </div>
          <Button
            variant="bark"
            type="submit"
            className="w-full rounded-ds-md"
            size="lg"
            disabled={loading}
          >
            {loading ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> Signing in…</> : "Sign in"}
          </Button>
        </form>

        <div className="flex items-center gap-3">
          <span className="h-px flex-1" style={{ backgroundColor: "hsl(var(--olivewood) / 0.14)" }} />
          <span
            className="text-ds-11 tracking-[0.2em] uppercase font-serif italic"
            style={{ color: "hsl(var(--burnt-sienna) / 0.7)" }}
          >
            or
          </span>
          <span className="h-px flex-1" style={{ backgroundColor: "hsl(var(--olivewood) / 0.14)" }} />
        </div>

        <div className="space-y-2">
          <AppleSignInButton label="Sign in with Apple" />
          <GoogleSignInButton label="Sign in with Google" />
        </div>

        <p className="text-center text-ds-11 font-sans pt-1" style={{ color: "hsl(var(--olivewood) / 0.7)" }}>
          New to Helpr?{" "}
          <Link
            to="/signup"
            className="font-semibold hover:underline"
            style={{ color: "hsl(var(--bark))" }}
          >
            Create an account
          </Link>
        </p>
      </div>

      <p className="text-center text-ds-11 font-sans leading-relaxed px-2 mt-6" style={{ color: "hsl(var(--olivewood) / 0.85)" }}>
        By signing in you agree to our{" "}
        <Link to="/terms" className="underline hover:opacity-80 active:opacity-60 transition-opacity">Terms</Link>
        {" · "}
        <Link to="/privacy" className="underline hover:opacity-80 active:opacity-60 transition-opacity">Privacy Policy</Link>
      </p>

      <div className="mt-4">
        <BuildStamp />
      </div>
    </AuthShell>
  );
};

export default Login;
