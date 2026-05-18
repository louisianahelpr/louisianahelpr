import { useState, useEffect } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Loader2, ArrowLeft } from "lucide-react";
import AuthShell from "@/components/auth/AuthShell";
import { usePageTitle } from "@/hooks/usePageTitle";

const ResetPassword = () => {
  usePageTitle("Set New Password — Helpr");
  const navigate = useNavigate();
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [loading, setLoading] = useState(false);
  const [ready, setReady] = useState(false);

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
      setTimeout(() => navigate("/dashboard"), 1500);
    }
  };

  return (
    <AuthShell eyebrow="Set a new password" maxWidth="sm">
      <div className="liquid-glass p-6 sm:p-8 space-y-6">
        <div className="text-center space-y-2">
          <span className="text-display-eyebrow">Reset password</span>
          <h1
            className="font-display italic font-bold leading-tight mt-2"
            style={{
              fontSize: "clamp(1.5rem, 2.5vw + 0.5rem, 2rem)",
              color: "hsl(var(--ink-deep))",
              letterSpacing: "-0.02em",
            }}
          >
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
              <Input
                id="password"
                type="password"
                placeholder="••••••••"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                minLength={8}
                autoComplete="new-password"
                className="rounded-ds-md bg-white/60 border-white/70"
              />
              <p className="text-ds-11" style={{ color: "hsl(var(--olivewood) / 0.6)" }}>
                At least 8 characters, 1 uppercase, 1 number
              </p>
            </div>
            <div className="space-y-2">
              <Label htmlFor="confirm" className="text-ds-13 font-sans font-medium">Confirm password</Label>
              <Input
                id="confirm"
                type="password"
                placeholder="••••••••"
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                required
                minLength={8}
                autoComplete="new-password"
                className="rounded-ds-md bg-white/60 border-white/70"
              />
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
