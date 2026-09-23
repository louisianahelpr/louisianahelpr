/**
 * Pure, stateless helpers for the admin user-management screen.
 *
 * Extracted verbatim from AdminUsers.tsx (step 1 of splitting that
 * 1,900-line file) — these close over nothing but their `Profile`
 * argument, so the move is behaviour-preserving.
 */
import type { Database } from "@/integrations/supabase/types";
import { Badge } from "@/components/ui/badge";
import { ShieldCheck, ShieldAlert } from "lucide-react";
import { isIdentityVerified } from "@/lib/awardGate";

export type Profile = Database["public"]["Tables"]["profiles"]["Row"];

// There is no approval review (Q193, owner 2026-09-23: every signup is
// auto-approved, bans are automated). The one pre-activation state an admin
// can still see is an unconfirmed email — the "Email" tab, which offers
// Resend Verification.
export const isVerifiedEmail = (p: Profile) => !!p.email_verified;
export const isAwaitingEmail = (p: Profile) => !isVerifiedEmail(p);

/**
 * "Manually Verify" sets idv_status = 'verified' (admin-user-actions
 * manual_verify). It applies only to someone whose identity is NOT already
 * verified by either route — Stripe Identity (idv_status) or Connect
 * (stripe_identity_verified), the same OR the award gate reads. Offering it
 * on a verified account (Q234) invited an admin to overwrite Stripe's verdict
 * with a manual one for nothing.
 */
export const canManuallyVerify = (p: Pick<Profile, "idv_status" | "stripe_identity_verified">) =>
  !isIdentityVerified({ connectIdentityVerified: p.stripe_identity_verified, idvStatus: p.idv_status });

export const statusBadge = (profile: Profile) => {
  const banStatus = profile.ban_status || "active";
  if (banStatus === "permanently_banned") return <Badge className="bg-destructive/10 text-destructive text-ds-11">Permanently Banned</Badge>;
  if (banStatus === "temp_banned") return <Badge className="bg-destructive/10 text-destructive text-ds-11">Temp Banned</Badge>;
  // "warned" status is intentionally not surfaced as a status badge — the strike chip
  // ("1st Strike", "Final Warning", etc.) already conveys this without duplication.
  if (!isVerifiedEmail(profile)) return <Badge className="bg-accent/20 text-[hsl(var(--accent-ink))] text-ds-11">Pending Email Verification</Badge>;
  return <Badge className="bg-primary/10 text-primary text-ds-11">Active</Badge>;
};

// Stripe Identity verification badge — green / yellow / gray.
// Shown for all users since IDV is required before accepting any job.
export const stripeBadge = (profile: Profile) => {
  const s = profile.idv_status;
  // An admin's manual approval is NOT Stripe's answer, and labelling it
  // "Stripe Verified" was the exact conflation that got the old ID queue
  // retired. Name who actually made the call.
  if (profile.legacy_manual_review) {
    return <Badge className="bg-primary/10 text-primary border-primary/20 text-ds-10 gap-0.5"><ShieldCheck className="w-2.5 h-2.5" />Admin Verified</Badge>;
  }
  // Same conflation one rung down, and it was live: prod has FOUR badged
  // profiles, and only ONE of them carries `stripe_identity_verified`. The
  // other three reached `idv_status = 'verified'` by some other route, so
  // this badge told an operator "Stripe Verified" about three accounts Stripe
  // has never returned a verdict on. Only claim Stripe when Stripe's own
  // column says so; otherwise state the unified verdict —
  // `identity_is_verified(idv_status, stripe_identity_verified)` is the OR of
  // the two, and "ID Verified" is what that OR actually means.
  if (profile.stripe_identity_verified) {
    return <Badge className="bg-primary/10 text-primary border-primary/20 text-ds-10 gap-0.5"><ShieldCheck className="w-2.5 h-2.5" />Stripe Verified</Badge>;
  }
  if (s === "verified") {
    return <Badge className="bg-primary/10 text-primary border-primary/20 text-ds-10 gap-0.5"><ShieldCheck className="w-2.5 h-2.5" />ID Verified</Badge>;
  }
  // Only the values profiles_idv_status_check actually permits. "approved",
  // "requires_input" and "action_needed" were listed here and are all
  // unreachable — the constraint rejects every one of them.
  if (s === "manual_review" || s === "failed") {
    return <Badge className="bg-accent/20 text-[hsl(var(--accent-ink))] border-accent/30 text-ds-10 gap-0.5"><ShieldAlert className="w-2.5 h-2.5" />Stripe Flagged</Badge>;
  }
  // Users never send an ID to us — Stripe Identity collects it (owner,
  // 2026-09-23). So the only honest states are Stripe's: checking, or not
  // verified. Until 2026-09-23 "pending"/"processing" (Stripe mid-check) fell
  // through to "ID Not Submitted", and that label implied a submission to us
  // that the product does not have. adminIdBadgeStates.test.tsx walks every
  // value profiles_idv_status_check allows so a new one cannot fall through.
  if (s === "pending" || s === "processing") {
    return <Badge className="bg-accent/20 text-[hsl(var(--accent-ink))] border-accent/30 text-ds-10 gap-0.5"><ShieldAlert className="w-2.5 h-2.5" />Stripe Checking</Badge>;
  }
  return <Badge variant="outline" className="text-muted-foreground text-ds-10 gap-0.5"><ShieldAlert className="w-2.5 h-2.5" />Not Verified</Badge>;
};
