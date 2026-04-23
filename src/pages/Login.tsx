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

    // Rate limiting: lock after 5 failed attempts for 60 seconds
    if (lockedUntil && Date.now() < lockedUntil) {
      const secondsLeft = Math.ceil((lockedUntil - Date.now()) / 1000);
      toast.error(`Too many attempts. Try again in ${secondsLeft}s`);
      return;
    }

    setLoading(true);
    const { data, error } = await supabase.auth.signInWithPassword({ email, password });
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

    // Block unverified emails
    const sessionUser = data.session?.user;
    if (sessionUser && !sessionUser.email_confirmed_at) {
      await supabase.auth.signOut();
      setLoading(false);
      toast.error("Please verify your email before logging in. Check your inbox for a verification link.");
      return;
    }

    // Check approval + ban status before redirecting
    const userId = sessionUser?.id;
    if (userId) {
      const { data: profile } = await supabase
        .from("profiles")
        .select("approval_status, ban_status")
        .eq("user_id", userId)
        .single();

      // Block banned users
      if (profile?.ban_status && ["banned", "temp_banned", "permanently_banned"].includes(profile.ban_status)) {
        await supabase.auth.signOut();
        setLoading(false);
        toast.error(
          profile.ban_status === "permanently_banned"
            ? "Your account has been permanently banned. Contact support if you believe this is an error."
            : "Your account has been temporarily suspended. Please try again later."
        );
        return;
      }

      // Invalidate cache without awaiting - don't block navigation
      queryClient.invalidateQueries({ queryKey: ["currentUser"] });

      setLoading(false);
      toast.success("Welcome back!");

      if (profile?.approval_status === "pending") {
        navigate("/account-pending", { replace: true });
      } else if (profile?.approval_status === "denied") {
        navigate("/account-denied", { replace: true });
      } else {
        navigate("/dashboard", { replace: true });
      }
    } else {
      setLoading(false);
      toast.success("Welcome back!");
      navigate("/dashboard");
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-b from-background to-secondary/20 px-5 py-10">
      <div className="w-full max-w-sm">
        <div className="text-center mb-8">
          <Link to="/" className="inline-block text-3xl font-display font-bold text-primary">
            Helpr
          </Link>
          <p className="mt-2 text-sm text-muted-foreground">Your Local Task Partner</p>
        </div>

        <div className="rounded-2xl border border-border/60 bg-card shadow-[var(--card-shadow)] p-6 sm:p-7 space-y-5">
        <GoogleSignInButton label="Log in with Google" />

        <div className="relative">
          <div className="absolute inset-0 flex items-center">
            <span className="w-full border-t border-border/60" />
          </div>
          <div className="relative flex justify-center text-xs uppercase">
            <span className="bg-card px-2 text-muted-foreground">or continue with email</span>
          </div>
        </div>

        <form onSubmit={handleLogin} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="email">Email</Label>
            <Input
              id="email"
              type="email"
              placeholder="you@example.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              autoComplete="email"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="password">Password</Label>
            <div className="relative">
              <Input
                id="password"
                type={showPassword ? "text" : "password"}
                placeholder="••••••••"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                autoComplete="current-password"
                className="pr-10"
              />
              <button type="button" onClick={() => setShowPassword(!showPassword)} className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors">
                {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>
          </div>
          <div className="flex items-center justify-between">
            <Link to="/forgot-password" className="text-sm text-muted-foreground hover:text-primary transition-colors">
              Forgot password?
            </Link>
          </div>
          <Button type="submit" className="w-full" size="lg" disabled={loading}>
            {loading ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> Logging in…</> : "Log in"}
          </Button>
        </form>

        <p className="text-center text-sm text-muted-foreground pt-1">
          Don't have an account?{" "}
          <Link to="/signup" className="text-primary font-semibold hover:underline">
            Sign up
          </Link>
        </p>
        </div>

        <p className="text-center text-xs text-muted-foreground/80 leading-relaxed px-2 mt-6">
          By logging in you agree to our{" "}
          <Link to="/terms" className="underline hover:text-foreground transition-colors">
            Terms
          </Link>{" "}
          ·{" "}
          <Link to="/privacy" className="underline hover:text-foreground transition-colors">
            Privacy Policy
          </Link>
        </p>
      </div>
    </div>
  );
};

export default Login;
