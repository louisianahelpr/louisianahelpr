import { useNavigate } from "react-router-dom";
import { LogOut } from "lucide-react";
import { Button } from "@/components/ui/button";
import AuthShell from "@/components/auth/AuthShell";
import { useSignOutAction } from "@/hooks/useSignOutAction";

/** Q1803 (owner 2026-10-21, COPPA): the exact sentence the ruling gives. */
const UNDER_13_MESSAGE = "You must be 13 or older to use Louisiana Helpr";

/**
 * Q1803: shown in place of every protected screen once the account is stamped
 * profiles.under_13_blocked_at (an under-13 birthday was refused; the server
 * never stored it and is deleting the account, under-13-delete). Nothing else
 * is reachable; the only action is signing out.
 */
export function Under13Blocked() {
  const navigate = useNavigate();
  const { signingOut, signOut } = useSignOutAction();
  return (
    <AuthShell hideBack hideHeader hideFooter centerColumn maxWidth="md">
      <div data-under-13-blocked="" className="liquid-glass p-7 sm:p-8 space-y-5 text-center">
        <h1 className="text-page-title leading-tight text-balance">{UNDER_13_MESSAGE}.</h1>
        <p className="font-sans text-ds-13" style={{ color: "hsl(var(--olivewood) / 0.8)" }}>
          Your account and its details are being deleted.
        </p>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => { void signOut({ after: () => navigate("/") }); }}
          disabled={signingOut}
        >
          <LogOut className="w-4 h-4 mr-1" /> {signingOut ? "Logging out…" : "Sign out"}
        </Button>
      </div>
    </AuthShell>
  );
}
