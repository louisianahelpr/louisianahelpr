import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Dialog,
  DialogContent,
  DialogHero,
  DialogFooter,
  DialogSecondaryAction,
  DialogPrimaryAction,
  DialogDestructiveAction,
} from "@/components/ui/dialog";
import { ShieldCheck, Copy, Check } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

interface VerifiedFactor {
  id: string;
  friendlyName: string | null | undefined;
}

// Authenticator-app (TOTP) two-step verification, backed by Supabase's
// native MFA — no SMS, no third-party vendor. A verified factor here is
// what the login-time challenge gate (Login.tsx) enforces on sign-in.
export function TwoFactorCard() {
  const {
    data: verified,
    isLoading,
    isError,
    refetch,
  } = useQuery<VerifiedFactor | null>({
    queryKey: ["security", "mfa-factor"],
    queryFn: async () => {
      const { data, error } = await supabase.auth.mfa.listFactors();
      // THROW, don't return null. `null` here is indistinguishable from "this
      // account has no TOTP factor", so a failed read rendered the card as
      // "Two-factor authentication — Off / Turn on" to a user who HAS it on.
      // A security control that misreports its own state is worse than one
      // that admits it doesn't know. The enroll query below already throws for
      // exactly this reason.
      if (error) throw error;
      const totp = data.totp.find((f) => f.status === "verified");
      return totp ? { id: totp.id, friendlyName: totp.friendly_name } : null;
    },
    staleTime: 30_000,
  });

  const [enrollOpen, setEnrollOpen] = useState(false);
  const [disableOpen, setDisableOpen] = useState(false);

  return (
    <div className="rounded-2xl liquid-glass p-3.5">
      {/* ONE card shape, shared with Email / Password / Face ID: the icon, the
          title block (title + its one line of prose), and the action, all on a
          single row. The prose used to run full width UNDER that row, which
          left a dead strip above it (the 44px button set the row height while
          the lone title line floated centred in it) and another below it before
          the card ended — the owner's "spacing under password and 2 step".
          It now sits directly beneath the title, where the email address sits
          on the first card.

          The "Off" pill is gone — a pill reading "Off" beside a button reading
          "Turn on" is the same fact twice. The "On" pill stays: that one is a
          state worth advertising, and "Turn off" is the action, not the state. */}
      <div className="flex items-center gap-2">
        <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
          <ShieldCheck className="w-4 h-4 text-primary" />
        </div>
        <div className="min-w-0 flex-1">
          <h2
            className="font-display italic font-bold leading-tight text-headline-card"
            style={{ color: "hsl(var(--ink-deep))", letterSpacing: "-0.015em" }}
          >
            Two-step verification
          </h2>
          {isLoading ? (
            // Sized to the one line of prose it stands in for, so the card
            // doesn't change height when the query lands.
            <Skeleton className="h-3.5 w-40 max-w-full mt-1 rounded-full" />
          ) : (
            <p
              className="text-ds-11 font-serif italic mt-0.5"
              style={{
                color: isError
                  ? "hsl(var(--destructive))"
                  : "hsl(var(--olivewood) / 0.8)",
              }}
            >
              {/* Shorter than before, because the prose now lives in the
                  title column (~163px at 393pt) instead of running the full
                  card width. Measured: the old 74-character string wrapped to
                  three lines there and made this card 28px taller than the
                  Email and Password cards beside it; "Authenticator code at
                  sign-in." is one line at 393pt and brings the card to within
                  12px of them — the remainder is the two-line TITLE, which is
                  content, not spacing. Nothing is lost: the enrol dialog is
                  where the setup instructions actually live. */}
              {isError
                ? "We couldn't check your status."
                : verified
                  ? "Required at sign-in. Support can remove it."
                  : "Authenticator code at sign-in."}
            </p>
          )}
        </div>
        {!isLoading && !isError && verified && (
          <span
            className="shrink-0 text-ds-10 font-bold uppercase tracking-wider px-2 py-0.5 rounded-full"
            style={{
              background: "hsl(var(--bark) / 0.12)",
              color: "hsl(var(--bark))",
              letterSpacing: "0.06em",
            }}
          >
            On
          </span>
        )}
        {/* Retry takes the action slot when the state is unknown, so the error
            branch keeps the same one-row silhouette as every other state
            instead of growing a second row of its own. */}
        {isError && (
          <Button
            size="sm"
            variant="outline"
            className="shrink-0"
            aria-label="Retry checking two-step verification status"
            onClick={() => refetch()}
          >
            Retry
          </Button>
        )}
        {/* Gated on !isError: with the state unknown, offering "Turn on" to
            someone who already HAS 2FA — or "Turn off" to someone who doesn't
            — is worse than offering nothing. */}
        {!isLoading && !isError && (verified ? (
          <Button
            size="sm"
            variant="outline"
            className="shrink-0"
            style={{
              borderColor: "hsl(var(--burnt-sienna) / 0.32)",
              color: "hsl(var(--burnt-sienna))",
            }}
            aria-label="Turn off two-step verification"
            onClick={() => setDisableOpen(true)}
          >
            Turn Off
          </Button>
        ) : (
          <Button
            size="sm"
            variant="outline"
            className="shrink-0"
            aria-label="Turn on two-step verification"
            onClick={() => setEnrollOpen(true)}
          >
            Turn On
          </Button>
        ))}
      </div>

      {enrollOpen && (
        <EnrollDialog
          open={enrollOpen}
          onClose={() => setEnrollOpen(false)}
          onEnrolled={() => {
            setEnrollOpen(false);
            void refetch();
          }}
        />
      )}
      {disableOpen && verified && (
        <DisableDialog
          open={disableOpen}
          factorId={verified.id}
          onClose={() => setDisableOpen(false)}
          onDisabled={() => {
            setDisableOpen(false);
            void refetch();
          }}
        />
      )}
    </div>
  );
}

// ── Enroll ────────────────────────────────────────────────────────────────

function EnrollDialog({
  open,
  onClose,
  onEnrolled,
}: {
  open: boolean;
  onClose: () => void;
  onEnrolled: () => void;
}) {
  // Enroll once on mount via useQuery so a fresh QR + secret is fetched
  // exactly when the dialog opens. Any abandoned unverified factors are
  // swept first so repeated open/close doesn't pile up dangling factors.
  const { data, isLoading, error } = useQuery({
    queryKey: ["security", "mfa-enroll"],
    queryFn: async () => {
      // Surface a listFactors() failure so an unrelated auth error can't
      // masquerade as "no stale factors, proceed with enrollment" — that
      // masked the real problem and produced hard-to-debug enrollment
      // failures downstream. Throw so the queryFn's error state kicks in
      // and the UI shows a proper error, not a spinning enroll dialog.
      const list = await supabase.auth.mfa.listFactors();
      if (list.error) throw list.error;
      const stale = list.data?.totp.filter((f) => f.status !== "verified") ?? [];
      await Promise.all(
        stale.map((f) => supabase.auth.mfa.unenroll({ factorId: f.id })),
      );
      const { data: enrolled, error: enrollError } = await supabase.auth.mfa.enroll({
        factorType: "totp",
        friendlyName: `Authenticator ${new Date().toISOString().slice(0, 10)}`,
      });
      if (enrollError) throw enrollError;
      return {
        factorId: enrolled.id,
        secret: enrolled.totp.secret,
      };
    },
    gcTime: 0,
    staleTime: 0,
    refetchOnWindowFocus: false,
    retry: false,
  });

  const [code, setCode] = useState("");
  const [verifying, setVerifying] = useState(false);
  const [copied, setCopied] = useState(false);

  const handleVerify = async () => {
    if (!data || code.trim().length !== 6) return;
    setVerifying(true);
    const { error: verifyError } = await supabase.auth.mfa.challengeAndVerify({
      factorId: data.factorId,
      code: code.trim(),
    });
    setVerifying(false);
    if (verifyError) {
      toast.error("That code didn't match. Check your app and try again.");
      return;
    }
    onEnrolled();
  };

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent onOpenAutoFocus={(e) => e.preventDefault()}>
        <DialogHero
          title="Turn On Two-Step?"
        />

        {isLoading ? (
          <Skeleton className="h-44 rounded-ds-md" />
        ) : error || !data ? (
          <p
            className="font-serif italic text-ds-11 py-4 text-center"
            style={{ color: "hsl(var(--burnt-sienna))" }}
          >
            Couldn't start setup. Please close and try again.
          </p>
        ) : (
          <>
            {/* No QR image: the owner removed every QR code from the app
                (2026-08-25). Enrolment is unaffected — an authenticator app
                accepts this setup key typed or pasted in, which is the same
                secret the QR encoded. The key is the primary control now
                rather than a fallback under the image, so it carries the
                instruction that used to be implied by the picture. */}
            <div className="flex flex-col items-center gap-2">
              <p
                className="font-serif italic text-ds-12 text-center"
                style={{ color: "hsl(var(--olivewood) / 0.85)" }}
              >
                In your authenticator app, choose “enter a setup key” and paste this:
              </p>
              <button
                type="button"
                onClick={async () => {
                  try {
                    await navigator.clipboard.writeText(data.secret);
                    setCopied(true);
                    window.setTimeout(() => setCopied(false), 1500);
                  } catch { /* clipboard unavailable */ }
                }}
                className="inline-flex items-center gap-1.5 text-ds-11 font-mono tracking-wider px-2.5 py-1 rounded-ds-sm"
                style={{
                  background: "hsla(0, 0%, 100%, 0.55)",
                  border: "0.5px solid hsl(var(--olivewood) / 0.16)",
                  color: "hsl(var(--ink-deep))",
                }}
              >
                {copied ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
                {data.secret}
              </button>
            </div>

            <div className="space-y-1.5">
              <Label
                htmlFor="mfa-code-input"
                className="font-serif italic uppercase text-ds-10"
                style={{ color: "hsl(var(--burnt-sienna))", letterSpacing: "0.18em" }}
              >
                6-digit code
              </Label>
              <Input
                id="mfa-code-input"
                inputMode="numeric"
                autoComplete="one-time-code"
                maxLength={6}
                value={code}
                onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
                onKeyDown={(e) => { if (e.key === "Enter") handleVerify(); }}
                className="tracking-[0.3em] text-center font-mono border-[hsl(var(--border)/0.6)] focus-visible:border-primary/40"
              />
            </div>
          </>
        )}

        <DialogFooter>
          <DialogSecondaryAction onClick={onClose}>
            Cancel
          </DialogSecondaryAction>
          <DialogPrimaryAction
            onClick={handleVerify}
            disabled={verifying || code.length !== 6 || !data}
          >
            {verifying ? "Verifying…" : "Verify & Turn On"}
          </DialogPrimaryAction>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── Disable ───────────────────────────────────────────────────────────────

function DisableDialog({
  open,
  factorId,
  onClose,
  onDisabled,
}: {
  open: boolean;
  factorId: string;
  onClose: () => void;
  onDisabled: () => void;
}) {
  const [code, setCode] = useState("");
  const [working, setWorking] = useState(false);

  // Disabling removes a verified factor, which requires the session to reach
  // AAL2 first. Proving possession with a fresh code (challengeAndVerify)
  // both elevates the session and confirms the user controls the device,
  // before we unenroll.
  const handleDisable = async () => {
    if (code.trim().length !== 6) return;
    setWorking(true);
    const challenge = await supabase.auth.mfa.challengeAndVerify({
      factorId,
      code: code.trim(),
    });
    if (challenge.error) {
      setWorking(false);
      toast.error("That code didn't match. Check your app and try again.");
      return;
    }
    const { error } = await supabase.auth.mfa.unenroll({ factorId });
    setWorking(false);
    if (error) {
      toast.error("Couldn't turn off two-step verification — try again?");
      return;
    }
    onDisabled();
  };

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent onOpenAutoFocus={(e) => e.preventDefault()}>
        <DialogHero
          title="Turn Off Two-Step?"
        />

        <div className="space-y-1.5">
          <Label
            htmlFor="mfa-disable-input"
            className="font-serif italic uppercase text-ds-10"
            style={{ color: "hsl(var(--burnt-sienna))", letterSpacing: "0.18em" }}
          >
            6-digit code
          </Label>
          <Input
            id="mfa-disable-input"
            inputMode="numeric"
            autoComplete="one-time-code"
            maxLength={6}
            value={code}
            onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
            onKeyDown={(e) => { if (e.key === "Enter") handleDisable(); }}
            className="tracking-[0.3em] text-center font-mono border-[hsl(var(--border)/0.6)] focus-visible:border-primary/40"
          />
        </div>

        <DialogFooter>
          <DialogSecondaryAction onClick={onClose}>
            Keep It On
          </DialogSecondaryAction>
          {/* Turning 2FA off is a security downgrade, so it keeps a
              destructive treatment — but the SHARED one. It was a flat inline
              burnt-sienna fill: a third colour for "destructive", alongside
              the `--destructive` red used by Confirm No-Show / Delete User /
              Deny Payout and the sienna BrandConfirmDialog used everywhere
              else. */}
          <DialogDestructiveAction
            onClick={handleDisable}
            disabled={working || code.length !== 6}
          >
            {working ? "Turning Off…" : "Turn Off"}
          </DialogDestructiveAction>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
