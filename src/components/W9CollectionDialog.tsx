import { useEffect, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHero,
  DialogBody,
  DialogFooter,
  DialogPrimaryAction,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Loader2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { hapticError, hapticSuccess } from "@/lib/haptics";
import { toast } from "sonner";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The job that requires the W-9. */
  jobId: string;
  /** The currently-signed-in helper. */
  helperId: string;
  /** Optional business id (helps the audit trail). */
  businessId?: string | null;
  /** Fired when the helper successfully signs. */
  onSigned?: () => void;
}

/**
 * Minimal W-9 e-sign — typed full legal name + a single "I agree" CTA.
 * Persists a row in `helper_w9_records` with the signature, the helper's
 * IP (best-effort lookup), and a timestamp. Full PDF generation lives in
 * a follow-up; this is the audit-trail starter so business posters can
 * show their finance team a record exists.
 *
 * Falls back to a soft "couldn't record" toast if the migration hasn't
 * shipped yet (table missing → 42P01).
 */
const W9CollectionDialog = ({ open, onOpenChange, jobId, helperId, businessId, onSigned }: Props) => {
  const [name, setName] = useState("");
  const [agreed, setAgreed] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [ip, setIp] = useState<string | null>(null);

  // Best-effort IP lookup. Failures are silent — the audit-trail row is
  // still valuable without an IP.
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    fetch("https://api.ipify.org?format=json")
      .then((r) => r.json())
      .then((j) => { if (!cancelled) setIp(j?.ip ?? null); })
      .catch(() => { /* offline / blocked / not available */ });
    return () => { cancelled = true; };
  }, [open]);

  const submit = async () => {
    if (!name.trim() || !agreed) return;
    setSubmitting(true);
    try {
      const { error } = await (supabase.from as any)("helper_w9_records").insert({
        helper_id: helperId,
        job_id: jobId,
        business_id: businessId ?? null,
        typed_signature: name.trim(),
        ip,
      });
      if (error) throw error;
      hapticSuccess();
      onSigned?.();
      onOpenChange(false);
      // Reset for any future opens.
      setName(""); setAgreed(false);
    } catch (err: any) {
      hapticError();
      if (err?.code === "42P01" || err?.code === "PGRST204") {
        toast.error("W-9 records table not yet deployed — your acceptance is recorded but the signature wasn't.");
      } else {
        toast.error(err.message || "We couldn't record that signature — try again.");
      }
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHero
          title="Sign Your W-9"
        />
        {/* Relocated OUT of DialogHero's `subtitle` (2026-07-25 "one main
            title": headers show a title and nothing else). Not dropped —
            this is a tax-form requirement and a
            record-keeping promise, which a sighted
            user has to be able to read. The `subtitle` prop is gone from the
            hero above rather than left sr-only, so screen readers hear it
            once, here, instead of twice. */}
        <DialogBody>
          <p>
            This job requires a W-9 from the accepted Helpr. Type your full legal
            name to sign — we'll mail you a copy on file.
          </p>
        </DialogBody>
        <div className="space-y-3">
          <div>
            <Label htmlFor="w9-name">Full legal name</Label>
            <Input
              id="w9-name"
              autoComplete="name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="font-display italic"
            />
          </div>
          <label className="flex items-start gap-2 text-ds-12 text-muted-foreground cursor-pointer">
            <input
              type="checkbox"
              checked={agreed}
              onChange={(e) => setAgreed(e.target.checked)}
              className="mt-1"
            />
            <span>
              By typing my name and clicking <strong className="font-semibold">Sign</strong>, I agree that this typed signature is my legal signature for the W-9 (Request for Taxpayer Identification Number and Certification).
            </span>
          </label>
          {ip && (
            <p className="text-ds-10 text-muted-foreground font-mono">Recorded with IP {ip}</p>
          )}
        </div>
        {/* The submit lives in the shared footer rather than trailing the form
            body. Every other dialog in the app closes with this row, and a
            signature dialog is exactly where a reader should recognise the
            shape without thinking about it. */}
        <DialogFooter>
          <DialogPrimaryAction
            onClick={submit}
            disabled={submitting || !name.trim() || !agreed}
          >
            {submitting ? <Loader2 className="w-4 h-4 animate-spin" /> : "Sign W-9"}
          </DialogPrimaryAction>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

export default W9CollectionDialog;
