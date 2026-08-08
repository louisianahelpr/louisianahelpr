import { useState, useEffect, useRef } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Loader2, Check, X } from "lucide-react";
import AuthShell from "@/components/auth/AuthShell";
import { AuthBrandPane } from "@/components/auth/AuthBrandPane";
import HelprMark from "@/components/HelprMark";
import { usePageTitle } from "@/hooks/usePageTitle";
import { friendlyAuthError } from "@/lib/authErrors";
import { passwordStrength } from "./signup/signupHelpers";

const ResetPassword = () => {
  usePageTitle("Set New Password — Helpr");
  const navigate = useNavigate();
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [loading, setLoading] = useState(false);
  const [ready, setReady] = useState(false);
  // When a link is invalid/expired/used, Supabase forwards `error=`,
  // `error_description=` in the URL hash and we surface the specific
  // case below. Null = no explicit error → treat as "no token / bare visit".
  const [linkError, setLinkError] = useState<"expired" | "used" | null>(null);
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

    // Distinguish the three "not ready" cases when possible so the user
    // sees a specific message instead of the generic "please use the
    // link from your email" that reads the same for an expired link, an
    // already-used link, and a bare visit with no token at all.
    //   * Supabase appends `error=access_denied` +
    //     `error_description=Email link is invalid or has expired` on an
    //     expired/used link — we surface those directly.
    //   * A truly empty hash means the user hit /reset-password without
    //     following a link at all → the "please use your email" copy.
    const err = hashParams.get("error");
    const errDesc = hashParams.get("error_description") ?? "";
    if (err === "access_denied") {
      if (/expired/i.test(errDesc)) {
        setLinkError("expired");
      } else if (/invalid|used/i.test(errDesc)) {
        setLinkError("used");
      } else {
        setLinkError("expired"); // safe default when Supabase widens the copy
      }
    }

    return () => subscription.unsubscribe();
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (password !== confirm) { toast.error("Passwords don't match"); return; }
    if (password.length < 8) { toast.error("Password needs at least 8 characters"); return; }
    if (!/[A-Z]/.test(password)) { toast.error("Add at least one uppercase letter"); return; }
    if (!/[0-9]/.test(password)) { toast.error("Add at least one number"); return; }
    setLoading(true);
    const { error } = await supabase.auth.updateUser({ password });
    setLoading(false);
    if (error) {
      toast.error(friendlyAuthError(error.message));
    } else {
      // updateUser leaves the recovery session live, which is effectively
      // already signed in — so route straight to /dashboard instead of
      // bouncing through /login. Shorter delay (800ms) reads as
      // confirmation without making the user stare at a toast.
      toast.success("Password updated — taking you in.");
      redirectTidRef.current = window.setTimeout(() => navigate("/dashboard", { replace: true }), 800);
    }
  };

  return (
    <AuthShell hideHeader maxWidth="sm" backTo="/login" desktopBrandPanel={<AuthBrandPane />}>
      <div className="text-center mb-8 space-y-2">
        {/* Redundant on desktop — AuthBrandPane hero already shows H. */}
        <div className="flex justify-center mb-3 lg:hidden">
          <HelprMark to={null} size="md" emblemOnly />
        </div>
        <h1
          className="font-display italic font-bold leading-tight"
          style={{
            fontSize: "clamp(1.85rem, 3vw + 0.5rem, 2.5rem)",
            color: "hsl(var(--ink-deep))",
            letterSpacing: "-0.03em",
          }}
        >
          Choose a new one.
        </h1>
        <p
          className="font-sans"
          style={{
            fontSize: "0.95rem",
            color: "hsl(var(--olivewood) / 0.8)",
            letterSpacing: "0.01em",
          }}
        >
          Set a new password for your account.
        </p>
      </div>
      <div className="liquid-glass p-6 sm:p-8 space-y-6">
        {!ready ? (
          <div className="text-center space-y-4">
            <p className="font-serif italic text-ds-13" style={{ color: "hsl(var(--olivewood) / 0.8)" }}>
              {linkError === "expired"
                ? "This password-reset link has expired. Reset links are single-use and time-limited — request a fresh one below."
                : linkError === "used"
                  ? "This password-reset link has already been used. Request a new one if you still need to change your password."
                  : "This page is used to reset your password. Please use the link from your email."}
            </p>
            <Link to="/forgot-password">
              <Button variant="outline" className="w-full rounded-ds-md">
                {linkError ? "Request a new reset link" : "Go to forgot password"}
              </Button>
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
                  className={`${passwordValid ? "pr-10" : ""} rounded-ds-md bg-white/60 dark:bg-white/5 border-[hsl(var(--bark)/0.28)] dark:border-white/15 shadow-[inset_0_1px_2px_hsl(var(--ink-deep)/0.05)] placeholder:text-[hsl(var(--olivewood)/0.8)]`}
                />
                {passwordValid && (
                  <Check className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-primary pointer-events-none" strokeWidth={2.5} aria-hidden />
                )}
              </div>
              {/* Strength meter — same scoring as the signup form so the
                  bar reads consistently across both screens. Burnt-sienna
                  for weak/fair, bark for good, primary green for strong. */}
              {password.length > 0 && (() => {
                const { score, label } = passwordStrength(password);
                const barColor =
                  score >= 4
                    ? "hsl(var(--primary))"
                    : score === 3
                      ? "hsl(var(--bark))"
                      : "hsl(var(--burnt-sienna))";
                return (
                  <div className="flex items-center gap-2">
                    <div className="flex gap-1 flex-1">
                      {[1, 2, 3, 4].map((i) => (
                        <span
                          key={i}
                          className="h-1 flex-1 rounded-full transition-colors"
                          style={{ background: i <= score ? barColor : "hsl(var(--olivewood) / 0.15)" }}
                        />
                      ))}
                    </div>
                    <span className="text-ds-11 font-sans w-10 text-right" style={{ color: barColor }}>
                      {label}
                    </span>
                  </div>
                );
              })()}
              <p className="text-ds-11" style={{ color: "hsl(var(--olivewood) / 0.8)" }}>
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
                  className={`${confirmValid ? "pr-10" : ""} rounded-ds-md bg-white/60 dark:bg-white/5 border-[hsl(var(--bark)/0.28)] dark:border-white/15 shadow-[inset_0_1px_2px_hsl(var(--ink-deep)/0.05)] placeholder:text-[hsl(var(--olivewood)/0.8)]`}
                />
                {confirmValid && (
                  <Check className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-primary pointer-events-none" strokeWidth={2.5} aria-hidden />
                )}
              </div>
              {/* Live match indicator — positive feedback when they
                  match, error when they diverge. The green check is
                  already in the input itself; this is the secondary
                  status line so the reason for the disabled submit is
                  unambiguous. */}
              {confirm.length > 0 && (
                confirm === password ? (
                  <p
                    className="inline-flex items-center gap-1 text-ds-11"
                    style={{ color: "hsl(var(--primary))" }}
                  >
                    <Check className="w-3 h-3" strokeWidth={2.5} aria-hidden /> Passwords match
                  </p>
                ) : (
                  <p
                    className="inline-flex items-center gap-1 text-ds-11 text-destructive"
                    role="alert"
                  >
                    <X className="w-3 h-3" strokeWidth={2.5} aria-hidden /> Passwords don't match
                  </p>
                )
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
      </div>
    </AuthShell>
  );
};

export default ResetPassword;
