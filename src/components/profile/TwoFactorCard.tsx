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
} from "@/components/ui/dialog";
import { ShieldCheck, Smartphone, Copy, Check } from "lucide-react";
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
    refetch,
  } = useQuery<VerifiedFactor | null>({
    queryKey: ["security", "mfa-factor"],
    queryFn: async () => {
      const { data, error } = await supabase.auth.mfa.listFactors();
      if (error) return null;
      const totp = data.totp.find((f) => f.status === "verified");
      return totp ? { id: totp.id, friendlyName: totp.friendly_name } : null;
    },
    staleTime: 30_000,
  });

  const [enrollOpen, setEnrollOpen] = useState(false);
  const [disableOpen, setDisableOpen] = useState(false);

  return (
    <div className="rounded-2xl liquid-glass p-5 space-y-3">
      <div className="flex items-center gap-2.5">
        <div className="w-9 h-9 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
          <ShieldCheck className="w-4 h-4 text-primary" />
        </div>
        <div className="min-w-0 flex-1">
          <h2
            className="font-display italic font-bold leading-tight text-headline-card"
            style={{ color: "hsl(var(--ink-deep))", letterSpacing: "-0.015em" }}
          >
            Two-step verification
          </h2>
        </div>
        {!isLoading && (
          <span
            className="shrink-0 text-ds-10 font-bold uppercase tracking-wider px-2 py-0.5 rounded-full"
            style={{
              background: verified
                ? "hsl(var(--bark) / 0.12)"
                : "hsl(var(--olivewood) / 0.10)",
              color: verified ? "hsl(var(--bark))" : "hsl(var(--olivewood))",
              letterSpacing: "0.06em",
            }}
          >
            {verified ? "On" : "Off"}
          </span>
        )}
      </div>

      {isLoading ? (
        <Skeleton className="h-9 rounded-ds-md" />
      ) : verified ? (
        <div className="flex items-center justify-between gap-3">
          <p
            className="text-ds-11 font-serif italic"
            style={{ color: "hsl(var(--olivewood) / 0.8)" }}
          >
            An authenticator app is required at sign-in. Keep it safe — if you
            lose access, contact support to remove it.
          </p>
          <Button
            size="sm"
            variant="outline"
            className="shrink-0"
            style={{
              borderColor: "hsl(var(--burnt-sienna) / 0.32)",
              color: "hsl(var(--burnt-sienna))",
            }}
            onClick={() => setDisableOpen(true)}
          >
            Turn off
          </Button>
        </div>
      ) : (
        <div className="flex items-center justify-between gap-3">
          <p
            className="text-ds-11 font-serif italic"
            style={{ color: "hsl(var(--olivewood) / 0.8)" }}
          >
            Add a code from an authenticator app at sign-in for extra account
            security.
          </p>
          <Button
            size="sm"
            variant="outline"
            className="shrink-0"
            onClick={() => setEnrollOpen(true)}
          >
            Turn on
          </Button>
        </div>
      )}

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
        qrCode: enrolled.totp.qr_code,
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
    toast.success("Two-step verification is on.");
    onEnrolled();
  };

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="!gap-3" onOpenAutoFocus={(e) => e.preventDefault()}>
        <DialogHero
          eyebrowClassName="inline-flex items-center gap-1.5"
          eyebrow={<><Smartphone className="w-3 h-3" /> Authenticator app</>}
          title="Turn on two-step."
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
            <div className="flex flex-col items-center gap-3">
              <img
                src={data.qrCode}
                alt="Two-step verification QR code"
                width={176}
                height={176}
                className="rounded-ds-md bg-white p-2"
                style={{ border: "0.5px solid hsl(var(--olivewood) / 0.16)" }}
              />
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
                className="font-serif italic uppercase"
                style={{ fontSize: "0.62rem", color: "hsl(var(--burnt-sienna))", letterSpacing: "0.18em" }}
              >
                6-digit code
              </Label>
              <Input
                id="mfa-code-input"
                inputMode="numeric"
                autoComplete="one-time-code"
                maxLength={6}
                placeholder="123456"
                value={code}
                onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
                onKeyDown={(e) => { if (e.key === "Enter") handleVerify(); }}
                className="tracking-[0.3em] text-center font-mono border-[hsl(var(--border)/0.6)] focus-visible:border-primary/40"
              />
            </div>
          </>
        )}

        <DialogFooter className="!gap-2">
          <Button variant="ghost" onClick={onClose} className="rounded-ds-md" style={{ color: "hsl(var(--bark))" }}>
            Cancel
          </Button>
          <Button
            variant="primary"
            onClick={handleVerify}
            disabled={verifying || code.length !== 6 || !data}
            className="rounded-ds-md"
          >
            {verifying ? "Verifying…" : "Verify & turn on"}
          </Button>
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
    toast.success("Two-step verification is off.");
    onDisabled();
  };

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="!gap-3" onOpenAutoFocus={(e) => e.preventDefault()}>
        <DialogHero
          eyebrowClassName="inline-flex items-center gap-1.5"
          eyebrow={<><ShieldCheck className="w-3 h-3" /> Two-step verification</>}
          title="Turn off two-step?"
        />

        <div className="space-y-1.5">
          <Label
            htmlFor="mfa-disable-input"
            className="font-serif italic uppercase"
            style={{ fontSize: "0.62rem", color: "hsl(var(--burnt-sienna))", letterSpacing: "0.18em" }}
          >
            6-digit code
          </Label>
          <Input
            id="mfa-disable-input"
            inputMode="numeric"
            autoComplete="one-time-code"
            maxLength={6}
            placeholder="123456"
            value={code}
            onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
            onKeyDown={(e) => { if (e.key === "Enter") handleDisable(); }}
            className="tracking-[0.3em] text-center font-mono border-[hsl(var(--border)/0.6)] focus-visible:border-primary/40"
          />
        </div>

        <DialogFooter className="!gap-2">
          <Button variant="ghost" onClick={onClose} className="rounded-ds-md" style={{ color: "hsl(var(--bark))" }}>
            Keep it on
          </Button>
          <Button
            onClick={handleDisable}
            disabled={working || code.length !== 6}
            className="rounded-ds-md"
            style={{
              background: "hsl(var(--burnt-sienna))",
              backgroundImage: "none",
              border: "1px solid hsl(var(--burnt-sienna))",
              color: "hsl(var(--parchment))",
            }}
          >
            {working ? "Turning off…" : "Turn off"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default TwoFactorCard;
