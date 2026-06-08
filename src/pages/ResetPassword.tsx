import { useState, useEffect, useRef } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Loader2, ArrowLeft, Check } from "lucide-react";
import AuthShell from "@/components/auth/AuthShell";
import { usePageTitle } from "@/hooks/usePageTitle";

const ResetPassword = () => {
  usePageTitle("Set New Password — Helpr");
  const navigate = useNavigate();
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [loading, setLoading] = useState(false);
  const [ready, setReady] = useState(false);
  // Holds the id of the post-success redirect timer so we can cancel it if
  // the user navigates away within the 1.5 s window — prevents a "navigate
  // on unmounted component" warning and a phantom navigation to /dashboard.
  const redirectTidRef = useRef<number | null>(null);

  useEffect(() => {
    return () => {
      if (redirectTidRef.current !== null) {
        window.clearTimeout(redirectTidRef.current);
      }
    };
  }, []);

  const passwordValid = password.length >= 8 && /[A-Z]/.test(password) && /[0-9]/.test(password);
  const confirmValid = confirm.length > 0 && confirm === password && passwordValid;

  useEffect(() => {
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === "PASSWORD_RECOVERY") setReady(true);
      if (event === "SIGNED_IN" && session) setReady(true);
    });

    supabase.auth.getSession().then(({ data: { session } }) => {
      if (session) setReady(true);
    });

    const hashParams = new URLSearchParams(window.location.hash.substring(1));
    if (hashParams.get("type") === "recovery") setReady(true);

    return () => subscription.unsubscribe();
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (password !== confirm) { toast.error("Passwords don't match"); return; }
    if (password.length < 8) { toast.error("Password must be at least 8 characters"); return; }
    if (!/[A-Z]/.test(password)) { toast.error("Password must contain at least one uppercase letter"); return; }
    if (!/[0-9]/.test(password)) { toast.error("Password must contain at least one number"); return; }
    setLoading(true);
    const { error } = await supabase.auth.updateUser({ password });
    setLoading(false);
    if (error) {
      toast.error(error.message);
    } else {
      toast.success("Password updated! Redirecting…");
      redirectTidRef.current = window.setTimeout(() => navigate("/dashboard"), 1500);
    }
  };

  return (
    <AuthShell eyebrow="Set a new password" maxWidth="sm" align="center">
      <div className="liquid-glass p-6 sm:p-8 space-y-6">
        <div className="text-center space-y-2">
          <span className="text-display-eyebrow">Reset password</span>
          <h1 className="text-page-title leading-tight mt-2">
            Choose a new one.
          </h1>
        </div>

        {!ready ? (
          <div className="text-center space-y-4">
            <p className="font-serif italic text-ds-13" style={{ color: "hsl(var(--olivewood) / 0.7)" }}>
              This page is used to reset your password. Please use the link from your email.
            </p>
            <Link to="/forgot-password">
              <Button variant="outline" className="w-full rounded-ds-md">Request a new reset link</Button>
            </Link>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="password" className="text-ds-13 font-sans font-medium">New password</Label>
              <div className="relative">
                <Input
                  id="password"
                  type="password"
                  placeholder="••••••••"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  minLength={8}
                  autoComplete="new-password"
                  className={`${passwordValid ? "pr-10" : ""} rounded-ds-md bg-white/60 dark:bg-white/5 border-[hsl(var(--bark)/0.28)] dark:border-white/15 shadow-[inset_0_1px_2px_hsl(var(--ink-deep)/0.05)] placeholder:text-[hsl(var(--olivewood)/0.7)]`}
                />
                {passwordValid && (
                  <Check className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-primary pointer-events-none" strokeWidth={2.5} aria-hidden />
                )}
              </div>
              <p className="text-ds-11" style={{ color: "hsl(var(--olivewood) / 0.6)" }}>
                At least 8 characters, 1 uppercase, 1 number
              </p>
            </div>
            <div className="space-y-2">
              <Label htmlFor="confirm" className="text-ds-13 font-sans font-medium">Confirm password</Label>
              <div className="relative">
                <Input
                  id="confirm"
                  type="password"
                  placeholder="••••••••"
                  value={confirm}
                  onChange={(e) => setConfirm(e.target.value)}
                  required
                  minLength={8}
                  autoComplete="new-password"
                  className={`${confirmValid ? "pr-10" : ""} rounded-ds-md bg-white/60 dark:bg-white/5 border-[hsl(var(--bark)/0.28)] dark:border-white/15 shadow-[inset_0_1px_2px_hsl(var(--ink-deep)/0.05)] placeholder:text-[hsl(var(--olivewood)/0.7)]`}
                />
                {confirmValid && (
                  <Check className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-primary pointer-events-none" strokeWidth={2.5} aria-hidden />
                )}
              </div>
              {confirm.length > 0 && confirm !== password && (
                <p className="text-ds-11 text-destructive" role="alert">Passwords don't match</p>
              )}
            </div>
            <Button
              variant="bark"
              type="submit"
              className="w-full rounded-ds-md"
              size="lg"
              disabled={loading}
            >
              {loading ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> Updating…</> : "Update password"}
            </Button>
          </form>
        )}

        <p className="text-center text-ds-11 pt-1" style={{ color: "hsl(var(--olivewood) / 0.7)" }}>
          <Link
            to="/login"
            className="font-semibold hover:underline inline-flex items-center gap-1"
            style={{ color: "hsl(var(--bark))" }}
          >
            <ArrowLeft className="w-3 h-3" /> Back to sign in
          </Link>
        </p>
      </div>
    </AuthShell>
  );
};

export default ResetPassword;
