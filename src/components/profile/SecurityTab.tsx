import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogHero,
  DialogFooter,
} from "@/components/ui/dialog";
import { Mail, Lock, Monitor, Smartphone, Tablet, LogOut } from "lucide-react";
import { BrandConfirmDialog } from "@/components/ui/BrandConfirmDialog";
import { supabase } from "@/integrations/supabase/client";
import { signOutWithPushCleanup } from "@/lib/authSignOut";
import { toast } from "sonner";
import { getPublicResetPasswordUrl, getPublicSiteUrl } from "@/lib/authRedirects";
import ProfileTabHeader from "@/components/profile/ProfileTabHeader";
import { TwoFactorCard } from "@/components/profile/TwoFactorCard";

interface LoginHistoryRow {
  id: string;
  created_at: string;
  ip_address: string | null;
  user_agent: string | null;
}

interface SessionGroup {
  fingerprint: string;
  label: string;
  icon: "phone" | "tablet" | "desktop";
  lastSeenAt: string;
  count: number;
  ipAddress: string | null;
}

// Coarse device fingerprint from a User-Agent string. Two sessions on
// the same physical device produce identical labels (e.g. "iPhone ·
// Safari") so we group instead of listing N near-duplicate rows.
function parseUserAgent(ua: string | null): { label: string; icon: SessionGroup["icon"] } {
  if (!ua) return { label: "Unknown device", icon: "desktop" };
  const lower = ua.toLowerCase();
  let device = "Desktop";
  let icon: SessionGroup["icon"] = "desktop";
  if (lower.includes("iphone")) { device = "iPhone"; icon = "phone"; }
  else if (lower.includes("ipad")) { device = "iPad"; icon = "tablet"; }
  else if (lower.includes("android")) {
    device = lower.includes("mobile") ? "Android phone" : "Android tablet";
    icon = device.includes("tablet") ? "tablet" : "phone";
  } else if (lower.includes("macintosh") || lower.includes("mac os")) device = "Mac";
  else if (lower.includes("windows")) device = "Windows PC";
  else if (lower.includes("linux")) device = "Linux PC";

  // Browser hint — keeps two devices that share a chassis distinguishable.
  let browser = "";
  if (lower.includes("edg/")) browser = "Edge";
  else if (lower.includes("chrome/") && !lower.includes("chromium")) browser = "Chrome";
  else if (lower.includes("firefox")) browser = "Firefox";
  else if (lower.includes("safari") && !lower.includes("chrome")) browser = "Safari";
  else if (lower.includes("capacitor") || lower.includes("helpr")) browser = "Helpr app";

  const label = browser ? `${device} · ${browser}` : device;
  return { label, icon };
}

interface SecurityTabProps {
  email: string | undefined;
  onBack: () => void;
}

export function SecurityTab({ email, onBack }: SecurityTabProps) {
  // Recent sessions, grouped by device fingerprint. login_history is
  // append-only (one row per SIGNED_IN), so we collapse to the most
  // recent N device fingerprints rather than show every login.
  const { data: sessionGroups = [], isLoading: sessionsLoading } = useQuery<SessionGroup[]>({
    queryKey: ["security", "sessions"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("login_history")
        .select("id, created_at, ip_address, user_agent")
        .order("created_at", { ascending: false })
        .limit(50);
      if (error) {
        // Non-blocking: a failed fetch shows an empty list (handled
        // below), not a red error state — sessions are informational
        // and a transient read failure shouldn't shout.
        return [];
      }
      const rows = (data as LoginHistoryRow[]) ?? [];
      const groups = new Map<string, SessionGroup>();
      rows.forEach((r) => {
        const { label, icon } = parseUserAgent(r.user_agent);
        const fingerprint = `${label}|${r.ip_address ?? ""}`;
        const existing = groups.get(fingerprint);
        if (existing) {
          existing.count += 1;
          // First row in (most recent first) already set lastSeenAt.
        } else {
          groups.set(fingerprint, {
            fingerprint,
            label,
            icon,
            lastSeenAt: r.created_at,
            count: 1,
            ipAddress: r.ip_address,
          });
        }
      });
      // Most recent first, cap at 5 — anything older is informational
      // noise (sessions roll on every login).
      return Array.from(groups.values())
        .sort((a, b) => new Date(b.lastSeenAt).getTime() - new Date(a.lastSeenAt).getTime())
        .slice(0, 5);
    },
    staleTime: 60_000,
    gcTime: 5 * 60_000,
  });

  // Global sign-out confirmation. Routed through BrandConfirmDialog
  // rather than window.confirm() — native dialogs are off-brand and
  // unreliable inside the Capacitor iOS WebView (the same reason the
  // change-email dialog below replaced prompt()).
  const [signOutDialogOpen, setSignOutDialogOpen] = useState(false);

  const handleSignOutAllOther = async () => {
    // Supabase doesn't expose a per-session revoke without an admin
    // service-role bearer (the `auth.admin.signOut` API). The closest
    // safe-to-ship action from the client is a global sign-out, which
    // revokes every refresh token for the user (incl. this device).
    setSignOutDialogOpen(false);
    const { error } = await signOutWithPushCleanup({ scope: "global" });
    if (error) {
      toast.error("Couldn't sign you out everywhere — try again?");
      return;
    }
    toast.success("Signed out everywhere.");
  };

  // Change-email uses an in-app branded dialog rather than the native
  // browser prompt() — prompt() is off-brand and unreliable inside the
  // Capacitor iOS WebView.
  const [emailDialogOpen, setEmailDialogOpen] = useState(false);
  const [newEmail, setNewEmail] = useState("");
  const [emailError, setEmailError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  // Prevents double-submit on the "Reset password" button — the Supabase
  // call is async and users on slow connections can tap twice.
  const [resettingPassword, setResettingPassword] = useState(false);

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
    if (error) {
      setSubmitting(false);
      toast.error(error.message);
      return;
    }
    // Notify the OLD address so the account owner hears about the change
    // even if a hostile session initiated it. Best-effort — a failure here
    // must NOT block the email change flow itself (Supabase already
    // accepted the request and mailed the new address), so a rejected
    // invoke just gets logged. Matches the notification the admin path
    // (admin-update-email) already sends.
    try {
      await supabase.functions.invoke("notify-email-change", {
        body: { newEmail: trimmed },
      });
    } catch (notifyErr) {
      console.warn("[SecurityTab] old-address notification failed", notifyErr);
    }
    setSubmitting(false);
    toast.success("Confirmation sent to your new email!");
    setEmailDialogOpen(false);
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
          <DialogHero
            eyebrowClassName="inline-flex items-center gap-1.5"
            eyebrow={<><Mail className="w-3 h-3" /> Account</>}
            title="Change email address."
            subtitle="A confirmation link will be sent to your new address before the change takes effect."
          />

          <div className="space-y-1.5">
            <Label
              htmlFor="new-email-input"
              className="font-serif italic uppercase"
              style={{ fontSize: "0.62rem", color: "hsl(var(--burnt-sienna))", letterSpacing: "0.18em" }}
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
              className="border-[hsl(var(--border)/0.6)] focus-visible:border-primary/40"
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

      {/* Global sign-out confirmation — branded replacement for the
          native confirm(). Sienna tone + warning copy because it signs
          out THIS device too. */}
      <BrandConfirmDialog
        open={signOutDialogOpen}
        onOpenChange={setSignOutDialogOpen}
        title="Sign out everywhere?"
        description="This signs out every device, including this one. You'll need to sign back in here."
        primaryLabel="Sign out everywhere"
        primaryTone="sienna"
        primaryHaptic="warning"
        onPrimary={handleSignOutAllOther}
        secondaryLabel="Cancel"
      />

      <div className="rounded-2xl liquid-glass p-5 space-y-3">
        <div className="flex items-center gap-2.5">
          <div className="w-9 h-9 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
            <Mail className="w-4 h-4 text-primary" />
          </div>
          <div className="min-w-0 flex-1">
            <h2 className="font-display italic font-bold leading-tight text-headline-card" style={{ color: "hsl(var(--ink-deep))", letterSpacing: "-0.015em" }}>
              Email address
            </h2>
          </div>
        </div>
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0 flex-1">
            <p className="text-ds-13 font-medium text-foreground truncate">{email}</p>
            <p className="text-ds-11 font-serif italic" style={{ color: "hsl(var(--olivewood) / 0.8)" }}>
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
            <h2 className="font-display italic font-bold leading-tight text-headline-card" style={{ color: "hsl(var(--ink-deep))", letterSpacing: "-0.015em" }}>
              Password
            </h2>
          </div>
        </div>
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0 flex-1">
            <p className="text-ds-13 font-medium text-foreground tracking-widest">••••••••</p>
            <p className="text-ds-11 font-serif italic" style={{ color: "hsl(var(--olivewood) / 0.8)" }}>
              Reset via secure email link.
            </p>
          </div>
          <Button
            size="sm"
            variant="outline"
            className="shrink-0"
            disabled={resettingPassword}
            onClick={async () => {
              if (!email || resettingPassword) return;
              setResettingPassword(true);
              const { error } = await supabase.auth.resetPasswordForEmail(email, {
                redirectTo: getPublicResetPasswordUrl(),
              });
              setResettingPassword(false);
              if (error) toast.error("Couldn't send the reset link — try again?");
              else toast.success("Password reset link sent to your email!");
            }}
          >
            {resettingPassword ? "Sending…" : "Reset"}
          </Button>
        </div>
      </div>

      <TwoFactorCard />

      {/* Active sessions — recent SIGNED_IN events grouped by coarse
          device fingerprint (OS + browser, scoped by IP). Read-only:
          the only safe-from-client revoke is a global sign-out, so the
          action is gated behind explicit "this includes this device"
          confirm copy rather than a misleading per-row "sign out this
          device" button. */}
      <div className="rounded-2xl liquid-glass p-5 space-y-3">
        <div className="flex items-center gap-2.5">
          <div className="w-9 h-9 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
            <Monitor className="w-4 h-4 text-primary" />
          </div>
          <div className="min-w-0 flex-1">
            <h2 className="font-display italic font-bold leading-tight text-headline-card" style={{ color: "hsl(var(--ink-deep))", letterSpacing: "-0.015em" }}>
              Active sessions
            </h2>
            <p className="text-ds-11 font-serif italic mt-0.5" style={{ color: "hsl(var(--olivewood) / 0.8)" }}>
              Recent sign-ins, grouped by device.
            </p>
          </div>
        </div>

        {sessionsLoading ? (
          <div className="space-y-2">
            {[1, 2].map((i) => (
              <Skeleton key={i} className="h-12 rounded-ds-md" />
            ))}
          </div>
        ) : sessionGroups.length === 0 ? (
          <p className="font-serif italic text-ds-11" style={{ color: "hsl(var(--olivewood) / 0.8)" }}>
            No recent sessions on record yet.
          </p>
        ) : (
          <div className="space-y-2">
            {sessionGroups.map((group, idx) => {
              const IconCmp =
                group.icon === "phone" ? Smartphone :
                group.icon === "tablet" ? Tablet : Monitor;
              const lastSeen = new Date(group.lastSeenAt);
              const minsAgo = Math.floor((Date.now() - lastSeen.getTime()) / 60_000);
              const when =
                minsAgo < 2 ? "just now" :
                minsAgo < 60 ? `${minsAgo}m ago` :
                minsAgo < 60 * 24 ? `${Math.floor(minsAgo / 60)}h ago` :
                minsAgo < 60 * 24 * 7 ? `${Math.floor(minsAgo / (60 * 24))}d ago` :
                lastSeen.toLocaleDateString("en-US", { month: "short", day: "numeric" });
              return (
                <div
                  key={group.fingerprint}
                  className="flex items-center gap-3 rounded-ds-md p-2.5"
                  style={{
                    background: "hsla(0, 0%, 100%, 0.55)",
                    border: "0.5px solid hsl(var(--olivewood) / 0.10)",
                  }}
                >
                  <span
                    className="shrink-0 w-9 h-9 rounded-full flex items-center justify-center"
                    style={{
                      background: idx === 0 ? "hsl(var(--bark) / 0.12)" : "hsl(var(--ivory-sand))",
                      color: "hsl(var(--bark))",
                    }}
                  >
                    <IconCmp className="w-4 h-4" />
                  </span>
                  <div className="flex-1 min-w-0">
                    <p
                      className="text-ds-13 font-semibold text-foreground leading-tight flex items-center gap-2 flex-wrap"
                    >
                      <span className="truncate">{group.label}</span>
                      {idx === 0 && (
                        <span
                          className="text-ds-10 font-bold uppercase tracking-wider px-1.5 py-0.5 rounded-full"
                          style={{
                            background: "hsl(var(--bark) / 0.12)",
                            color: "hsl(var(--bark))",
                            letterSpacing: "0.06em",
                          }}
                        >
                          This device
                        </span>
                      )}
                    </p>
                    <p
                      className="text-ds-11 font-serif italic mt-0.5"
                      style={{ color: "hsl(var(--olivewood) / 0.8)" }}
                    >
                      Last seen {when}
                      {group.ipAddress && <span className="ml-1.5">· {group.ipAddress}</span>}
                      {group.count > 1 && <span className="ml-1.5">· {group.count} sign-ins</span>}
                    </p>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {sessionGroups.length > 0 && (
          <Button
            variant="outline"
            size="sm"
            onClick={() => setSignOutDialogOpen(true)}
            className="w-full"
            style={{
              borderColor: "hsl(var(--burnt-sienna) / 0.32)",
              color: "hsl(var(--burnt-sienna))",
            }}
          >
            <LogOut className="w-3.5 h-3.5 mr-1.5" /> Sign out everywhere
          </Button>
        )}
      </div>

      {/* Delete Account moved to the landing tab, directly under
          Sign out — keeps all destructive account actions grouped at
          the bottom of the profile rather than buried in Security. */}
    </div>
  );
}

export default SecurityTab;
