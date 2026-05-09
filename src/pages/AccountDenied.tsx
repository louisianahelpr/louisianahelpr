import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { XCircle, RefreshCw, Mail, LogOut } from "lucide-react";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import AuthShell from "@/components/auth/AuthShell";
import { usePageTitle } from "@/hooks/usePageTitle";

const AccountDenied = () => {
  usePageTitle("Account Denied — Helpr");
  const navigate = useNavigate();
  const [denyReason, setDenyReason] = useState("");

  useEffect(() => {
    const check = async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.user) { navigate("/login"); return; }
      const { data: profile } = await supabase
        .from("profiles")
        .select("approval_status, denial_reason")
        .eq("user_id", session.user.id)
        .single();
      if (!profile) return;
      if (profile.approval_status === "approved") navigate("/dashboard");
      if (profile.approval_status === "pending") navigate("/account-pending");
      if (profile.denial_reason) setDenyReason(profile.denial_reason);
    };
    check();
  }, [navigate]);

  return (
    <AuthShell hideBack eyebrow="Account status" maxWidth="md">
      <div className="liquid-glass p-7 sm:p-8 space-y-6 text-center">
        <div
          className="w-16 h-16 rounded-2xl flex items-center justify-center mx-auto"
          style={{ background: "hsl(var(--burnt-sienna) / 0.12)" }}
        >
          <XCircle className="w-8 h-8" style={{ color: "hsl(var(--burnt-sienna))" }} strokeWidth={1.5} />
        </div>

        <div className="space-y-2">
          <span className="text-display-eyebrow">Not approved</span>
          <h1
            className="font-display italic font-bold leading-tight mt-1"
            style={{
              fontSize: "clamp(1.6rem, 2.5vw + 0.5rem, 2rem)",
              color: "hsl(var(--ink-deep))",
              letterSpacing: "-0.025em",
            }}
          >
            We couldn't approve your account.
          </h1>
          <p className="font-serif italic text-sm" style={{ color: "hsl(var(--olivewood) / 0.75)" }}>
            Unfortunately, your account was not approved at this time.
          </p>
        </div>

        {denyReason && (
          <div
            className="rounded-2xl p-4 text-left"
            style={{
              background: "hsl(var(--burnt-sienna) / 0.08)",
              border: "1px solid hsl(var(--burnt-sienna) / 0.2)",
            }}
          >
            <p
              className="text-[0.7rem] font-serif italic uppercase tracking-[0.18em] mb-1"
              style={{ color: "hsl(var(--burnt-sienna))" }}
            >
              Reason
            </p>
            <p className="text-sm font-sans" style={{ color: "hsl(var(--ink-deep))" }}>{denyReason}</p>
          </div>
        )}

        <div className="border-t pt-6 space-y-4 text-left" style={{ borderColor: "hsl(var(--olivewood) / 0.12)" }}>
          <h2
            className="text-[0.7rem] font-serif italic uppercase tracking-[0.18em] text-center"
            style={{ color: "hsl(var(--burnt-sienna))" }}
          >
            What can you do?
          </h2>

          <div className="flex items-start gap-3">
            <div className="w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0 mt-0.5" style={{ background: "hsl(var(--bark) / 0.1)" }}>
              <RefreshCw className="w-4 h-4" style={{ color: "hsl(var(--bark))" }} strokeWidth={1.75} />
            </div>
            <div>
              <p className="text-sm font-sans font-semibold" style={{ color: "hsl(var(--ink-deep))" }}>Re-apply with updated info</p>
              <p className="text-xs font-sans mt-0.5" style={{ color: "hsl(var(--olivewood) / 0.7)" }}>
                Sign up again with the same email to resubmit your profile with a new photo, ID, and details.
              </p>
            </div>
          </div>

          <div className="flex items-start gap-3">
            <div className="w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0 mt-0.5" style={{ background: "hsl(var(--bark) / 0.1)" }}>
              <Mail className="w-4 h-4" style={{ color: "hsl(var(--bark))" }} strokeWidth={1.75} />
            </div>
            <div>
              <p className="text-sm font-sans font-semibold" style={{ color: "hsl(var(--ink-deep))" }}>Contact support</p>
              <p className="text-xs font-sans mt-0.5" style={{ color: "hsl(var(--olivewood) / 0.7)" }}>
                If you think this was a mistake, reach out to our team.
              </p>
            </div>
          </div>
        </div>

        <div className="flex flex-col gap-3">
          <Button
            className="w-full rounded-xl"
            size="lg"
            onClick={async () => { await supabase.auth.signOut(); navigate("/signup"); }}
            style={{
              background: "hsl(var(--bark))",
              backgroundImage: "none",
              border: "1px solid hsl(var(--bark))",
              color: "hsl(var(--parchment))",
              fontFamily: "Montserrat, system-ui, sans-serif",
              fontWeight: 600,
            }}
          >
            <RefreshCw className="w-4 h-4 mr-2" />
            Re-apply now
          </Button>
          <a href="mailto:admin@louisianahelpr.com">
            <Button variant="ghost" className="w-full rounded-xl" size="sm">
              <Mail className="w-4 h-4 mr-2" />
              Email support
            </Button>
          </a>
        </div>

        <p className="text-xs font-sans" style={{ color: "hsl(var(--olivewood) / 0.6)" }}>
          Need help? Email us at{" "}
          <a
            href="mailto:admin@louisianahelpr.com"
            className="font-semibold hover:underline"
            style={{ color: "hsl(var(--bark))" }}
          >
            admin@louisianahelpr.com
          </a>
        </p>
      </div>

      <div className="text-center mt-5">
        <Button
          variant="ghost"
          size="sm"
          onClick={async () => { await supabase.auth.signOut(); navigate("/"); }}
          className="text-muted-foreground"
        >
          <LogOut className="w-4 h-4 mr-1" /> Sign out
        </Button>
      </div>
    </AuthShell>
  );
};

export default AccountDenied;
