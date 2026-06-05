import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Mail, Lock } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { getPublicResetPasswordUrl, getPublicSiteUrl } from "@/lib/authRedirects";
import ProfileTabHeader from "@/components/profile/ProfileTabHeader";

interface SecurityTabProps {
  email: string | undefined;
  onBack: () => void;
}

export function SecurityTab({ email, onBack }: SecurityTabProps) {
  // Change-email uses an in-app branded dialog rather than the native
  // browser prompt() — prompt() is off-brand and unreliable inside the
  // Capacitor iOS WebView.
  const [emailDialogOpen, setEmailDialogOpen] = useState(false);
  const [newEmail, setNewEmail] = useState("");
  const [emailError, setEmailError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const validateEmail = (value: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim());

  const handleOpenEmailDialog = () => {
    setNewEmail("");
    setEmailError("");
    setEmailDialogOpen(true);
  };

  const handleEmailChange = async () => {
    const trimmed = newEmail.trim();
    if (!trimmed) {
      setEmailError("Please enter an email address.");
      return;
    }
    if (!validateEmail(trimmed)) {
      setEmailError("Please enter a valid email address.");
      return;
    }
    setEmailError("");
    setSubmitting(true);
    const { error } = await supabase.auth.updateUser(
      { email: trimmed },
      { emailRedirectTo: getPublicSiteUrl() }
    );
    setSubmitting(false);
    if (error) {
      toast.error(error.message);
    } else {
      toast.success("Confirmation sent to your new email!");
      setEmailDialogOpen(false);
    }
  };

  return (
    <div className="space-y-6">
      <ProfileTabHeader
        eyebrow="Account"
        title="Security"
        meta="Email, password, sign-in"
        onBack={onBack}
      />

      {/* Change-email dialog — replaces the native prompt(). iOS keyboard
          is suppressed on open via onOpenAutoFocus (the same pattern the
          Dispute / Cancellation dialogs use). */}
      <Dialog open={emailDialogOpen} onOpenChange={(open) => { if (!open) setEmailDialogOpen(false); }}>
        <DialogContent
          className="!gap-3"
          onOpenAutoFocus={(e) => e.preventDefault()}
        >
          <DialogHeader className="!text-left space-y-0">
            <span
              className="font-serif italic uppercase inline-flex items-center gap-1.5"
              style={{ fontSize: "0.62rem", color: "hsl(var(--burnt-sienna))", letterSpacing: "0.18em" }}
            >
              <Mail className="w-3 h-3" /> Account
            </span>
            <DialogTitle
              className="font-display italic font-bold leading-tight mt-1"
              style={{ fontSize: "clamp(1.2rem, 2vw + 0.4rem, 1.45rem)", color: "hsl(var(--ink-deep))", letterSpacing: "-0.025em" }}
            >
              Change email address.
            </DialogTitle>
            <p
              className="font-serif italic mt-1"
              style={{ fontSize: "0.82rem", color: "hsl(var(--olivewood) / 0.75)" }}
            >
              A confirmation link will be sent to your new address before the change takes effect.
            </p>
          </DialogHeader>

          <div className="space-y-1.5">
            <Label
              htmlFor="new-email-input"
              className="font-serif italic uppercase"
              style={{ fontSize: "0.62rem", color: "hsl(var(--burnt-sienna) / 0.78)", letterSpacing: "0.18em" }}
            >
              New email address
            </Label>
            <Input
              id="new-email-input"
              type="email"
              inputMode="email"
              autoComplete="email"
              placeholder="you@example.com"
              value={newEmail}
              onChange={(e) => {
                setNewEmail(e.target.value);
                if (emailError) setEmailError("");
              }}
              onKeyDown={(e) => { if (e.key === "Enter") handleEmailChange(); }}
              className="bg-white/60 border-border/60 focus-visible:bg-white focus-visible:border-primary/40"
            />
            {emailError && (
              <p className="text-ds-11 font-serif italic" role="alert" style={{ color: "hsl(var(--burnt-sienna))" }}>
                {emailError}
              </p>
            )}
          </div>

          <DialogFooter className="!gap-2">
            <Button
              variant="ghost"
              onClick={() => setEmailDialogOpen(false)}
              className="rounded-ds-md font-sans font-semibold"
              style={{ color: "hsl(var(--bark))" }}
            >
              Cancel
            </Button>
            <Button
              onClick={handleEmailChange}
              disabled={submitting || !newEmail.trim()}
              className="rounded-ds-md"
              style={{
                background: newEmail.trim() ? "hsl(var(--bark))" : undefined,
                backgroundImage: "none",
                border: newEmail.trim() ? "1px solid hsl(var(--bark))" : undefined,
                color: newEmail.trim() ? "hsl(var(--parchment))" : undefined,
                fontFamily: "Montserrat, system-ui, sans-serif",
                fontWeight: 600,
                letterSpacing: "0.01em",
                boxShadow: newEmail.trim()
                  ? "0 1px 2px hsl(var(--bark) / 0.2), 0 8px 20px -6px hsl(var(--bark) / 0.28)"
                  : undefined,
              }}
            >
              {submitting ? "Sending…" : "Confirm change"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <div className="rounded-2xl liquid-glass p-5 space-y-3">
        <div className="flex items-center gap-2.5">
          <div className="w-9 h-9 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
            <Mail className="w-4 h-4 text-primary" />
          </div>
          <div className="min-w-0 flex-1">
            <p className="font-serif italic uppercase text-[0.6rem]" style={{ color: "hsl(var(--burnt-sienna) / 0.78)", letterSpacing: "0.18em" }}>
              Login email
            </p>
            <h2 className="font-display italic font-bold leading-tight text-headline-card" style={{ color: "hsl(var(--ink-deep))", letterSpacing: "-0.015em" }}>
              Email address
            </h2>
          </div>
        </div>
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0 flex-1">
            <p className="text-ds-13 font-medium text-foreground truncate">{email}</p>
            <p className="text-ds-11 font-serif italic" style={{ color: "hsl(var(--olivewood) / 0.7)" }}>
              We'll send a confirmation link to verify changes.
            </p>
          </div>
          <Button
            size="sm"
            variant="outline"
            className="shrink-0"
            onClick={handleOpenEmailDialog}
          >
            Change
          </Button>
        </div>
      </div>

      <div className="rounded-2xl liquid-glass p-5 space-y-3">
        <div className="flex items-center gap-2.5">
          <div className="w-9 h-9 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
            <Lock className="w-4 h-4 text-primary" />
          </div>
          <div className="min-w-0 flex-1">
            <p className="font-serif italic uppercase text-[0.6rem]" style={{ color: "hsl(var(--burnt-sienna) / 0.78)", letterSpacing: "0.18em" }}>
              Sign-in
            </p>
            <h2 className="font-display italic font-bold leading-tight text-headline-card" style={{ color: "hsl(var(--ink-deep))", letterSpacing: "-0.015em" }}>
              Password
            </h2>
          </div>
        </div>
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0 flex-1">
            <p className="text-ds-13 font-medium text-foreground tracking-widest">••••••••</p>
            <p className="text-ds-11 font-serif italic" style={{ color: "hsl(var(--olivewood) / 0.7)" }}>
              Reset via secure email link.
            </p>
          </div>
          <Button
            size="sm"
            variant="outline"
            className="shrink-0"
            onClick={async () => {
              if (!email) return;
              const { error } = await supabase.auth.resetPasswordForEmail(email, {
                redirectTo: getPublicResetPasswordUrl(),
              });
              if (error) toast.error(error.message);
              else toast.success("Password reset link sent to your email!");
            }}
          >
            Reset
          </Button>
        </div>
      </div>

      {/* Delete Account moved to the landing tab, directly under
          Sign out — keeps all destructive account actions grouped at
          the bottom of the profile rather than buried in Security. */}
    </div>
  );
}

export default SecurityTab;
