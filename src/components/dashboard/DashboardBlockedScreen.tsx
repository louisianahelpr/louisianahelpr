import { XCircle } from "lucide-react";
import AppShell from "@/components/AppShell";
import DashboardHeader from "@/components/dashboard/DashboardHeader";
import { Button } from "@/components/ui/button";

interface BannedScreenProps {
  banStatus: "permanently_banned" | "temp_banned";
}

/**
 * Banned-account stop screen. `/dashboard` is a fixed-shell route; an inline
 * `min-h-screen` would be clipped by html.app-shell's overflow:hidden.
 * AppShell gives this short message a 100dvh container with an internal
 * scroll surface so the text never escapes the viewport.
 */
export const DashboardBannedScreen = ({ banStatus }: BannedScreenProps) => (
  <AppShell reserveBottomNav={false} className="bg-premium-page">
    <div className="flex-1 flex items-center justify-center px-4">
      <div className="max-w-md text-center space-y-4">
        <div className="w-16 h-16 rounded-full bg-destructive/10 flex items-center justify-center mx-auto">
          <XCircle className="w-8 h-8 text-destructive" />
        </div>
        <h1 className="text-page-title text-foreground text-ds-24">
          Account {banStatus === "permanently_banned" ? "Permanently Banned" : "Temporarily Suspended"}
        </h1>
        <p className="text-muted-foreground">
          {banStatus === "permanently_banned"
            ? "Your account has been permanently banned for violating platform rules. Contact support if you believe this is an error."
            : "Your account has been temporarily suspended. You'll regain access once the suspension period ends."}
        </p>
      </div>
    </div>
  </AppShell>
);

interface DeniedScreenProps {
  onSignOut: () => void;
}

/**
 * Denied-profile stop screen. `/dashboard` is a fixed-shell route — wrap in
 * AppShell so the DashboardHeader carries the safe-area-top inset and the
 * body never spills past html.app-shell's overflow:hidden.
 */
export const DashboardDeniedScreen = ({ onSignOut }: DeniedScreenProps) => (
  <AppShell header={<DashboardHeader />} reserveBottomNav={false} className="bg-premium-page">
    <div className="container mx-auto px-5 py-12">
      <div className="max-w-lg mx-auto text-center space-y-6">
        <div className="w-16 h-16 rounded-full bg-destructive/10 flex items-center justify-center mx-auto"><XCircle className="w-8 h-8 text-destructive" /></div>
        <h1 className="text-page-title text-foreground text-ds-24">Profile not approved</h1>
        <p className="text-muted-foreground">Unfortunately, your profile was not approved. Please contact support.</p>
        <div className="flex items-center justify-center gap-2 pt-2">
          <Button variant="outline" onClick={onSignOut} className="rounded-ds-md">
            Sign Out
          </Button>
        </div>
      </div>
    </div>
  </AppShell>
);
