import { Button } from "@/components/ui/button";
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
  return (
    <div className="space-y-6">
      <ProfileTabHeader
        eyebrow="Account"
        title="Security"
        meta="Email, password, sign-in"
        onBack={onBack}
      />

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
            onClick={async () => {
              const newEmail = prompt("Enter new email address:");
              if (!newEmail) return;
              const { error } = await supabase.auth.updateUser(
                { email: newEmail },
                { emailRedirectTo: getPublicSiteUrl() }
              );
              if (error) toast.error(error.message);
              else toast.success("Confirmation sent to your new email!");
            }}
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
