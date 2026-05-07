import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Loader2, Eye, EyeOff } from "lucide-react";
import { usePageTitle } from "@/hooks/usePageTitle";
import { useQueryClient } from "@tanstack/react-query";
import { GoogleSignInButton } from "@/components/auth/GoogleSignInButton";
import { AppleSignInButton } from "@/components/auth/AppleSignInButton";
import AuthShell from "@/components/auth/AuthShell";

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
  usePageTitle("Log In — Helpr");
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
      toast.error(`Too many attempts. Try again in ${secondsLeft}s`);
      return;
    }

    setLoading(true);
    const { data, error } = await signInWithTimeout(email, password).catch((error: Error) => ({ data: { session: null }, error }));
    if (error) {
      setLoading(false);
      const newAttempts = loginAttempts + 1;
      setLoginAttempts(newAttempts);
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
      toast.error("Please verify your email before logging in. Check your inbox for a verification link.");
      return;
    }

    void queryClient.invalidateQueries({ queryKey: ["currentUser"] });
    setLoading(false);
    toast.success("Welcome back!");
    navigate("/dashboard", { replace: true });
  };

  return (
    <AuthShell hideHeader>
      <div className="text-center mb-5 space-y-2">
        <span className="text-display-eyebrow">Sign in</span>
        <h1
          className="font-display italic font-bold leading-tight mt-2"
          style={{
            fontSize: "clamp(1.85rem, 3vw + 0.5rem, 2.5rem)",
            color: "hsl(var(--ink-deep))",
            letterSpacing: "-0.03em",
          }}
        >
          Glad you're back.
        </h1>
        <p
          className="font-serif italic"
          style={{
            fontSize: "1rem",
            color: "hsl(var(--olivewood) / 0.7)",
          }}
        >
          Pick up right where you left off.
        </p>
      </div>

      <div className="liquid-glass px-6 sm:px-8 py-6 sm:py-7 space-y-5">
        <form onSubmit={handleLogin} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="email" className="text-sm font-sans font-medium">Email</Label>
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
              className="rounded-xl bg-white/60 border-white/70"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="password" className="text-sm font-sans font-medium">Password</Label>
            <div className="relative">
              <Input
                id="password"
                type={showPassword ? "text" : "password"}
                placeholder="••••••••"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                autoComplete="current-password"
                className="pr-10 rounded-xl bg-white/60 border-white/70"
              />
              <button type="button" onClick={() => setShowPassword(!showPassword)} className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors">
                {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>
          </div>
          <div className="flex items-center justify-between">
            <Link
              to="/forgot-password"
              className="text-xs font-sans tracking-wide hover:opacity-70 transition-opacity"
              style={{ color: "hsl(var(--burnt-sienna))" }}
            >
              Forgot password?
            </Link>
          </div>
          <Button
            type="submit"
            className="w-full rounded-xl"
            size="lg"
            disabled={loading}
            style={{
              background: "hsl(var(--bark))",
              backgroundImage: "none",
              border: "1px solid hsl(var(--bark))",
              color: "hsl(var(--parchment))",
              fontFamily: "Montserrat, system-ui, sans-serif",
              fontWeight: 600,
              letterSpacing: "0.01em",
              boxShadow: "0 1px 2px rgba(0,0,0,0.04), 0 12px 32px -8px rgba(0,0,0,0.1)",
            }}
          >
            {loading ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> Signing in…</> : "Sign in"}
          </Button>
        </form>

        <div className="relative">
          <div className="absolute inset-0 flex items-center">
            <span className="w-full border-t" style={{ borderColor: "hsl(var(--olivewood) / 0.12)" }} />
          </div>
          <div className="relative flex justify-center">
            <span
              className="px-3 text-[0.7rem] tracking-[0.2em] uppercase font-serif italic"
              style={{
                background: "hsla(0, 0%, 100%, 0.42)",
                color: "hsl(var(--burnt-sienna) / 0.7)",
              }}
            >
              or
            </span>
          </div>
        </div>

        <div className="space-y-2">
          <GoogleSignInButton label="Sign in with Google" />
          <AppleSignInButton label="Sign in with Apple" />
        </div>

        <p className="text-center text-xs font-sans pt-1" style={{ color: "hsl(var(--olivewood) / 0.7)" }}>
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

      <p className="text-center text-[0.7rem] font-sans leading-relaxed px-2 mt-6" style={{ color: "hsl(var(--olivewood) / 0.55)" }}>
        By signing in you agree to our{" "}
        <Link to="/terms" className="underline hover:opacity-80 transition-opacity">Terms</Link>
        {" · "}
        <Link to="/privacy" className="underline hover:opacity-80 transition-opacity">Privacy Policy</Link>
      </p>
    </AuthShell>
  );
};

export default Login;
