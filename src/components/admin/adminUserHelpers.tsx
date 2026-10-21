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

export type Profile = Database["public"]["Tables"]["profiles"]["Row"];

// There is no approval review (Q193, owner 2026-09-23: every signup is
// auto-approved, bans are automated). The one pre-activation state an admin
// can still see is an unconfirmed email — the "Email" tab, which offers
// Resend Verification.
export const isVerifiedEmail = (p: Profile) => !!p.email_verified;
export const isAwaitingEmail = (p: Profile) => !isVerifiedEmail(p);

export const statusBadge = (profile: Profile) => {
  const banStatus = profile.ban_status || "active";
  if (banStatus === "permanently_banned") return <Badge className="bg-destructive/10 text-destructive-ink text-ds-11">Permanently Banned</Badge>;
  if (banStatus === "temp_banned") return <Badge className="bg-destructive/10 text-destructive-ink text-ds-11">Temp Banned</Badge>;
  // "warned" status is intentionally not surfaced as a status badge — the strike chip
  // ("1st Strike", "Final Warning", etc.) already conveys this without duplication.
  if (!isVerifiedEmail(profile)) return <Badge className="bg-accent/20 text-[hsl(var(--accent-ink))] text-ds-11">Pending Email Verification</Badge>;
  return <Badge className="bg-primary/10 text-primary text-ds-11">Active</Badge>;
};

// Stripe Identity verification badge — green / yellow / gray.
// Shown for all users since IDV is required before accepting any job.
export const stripeBadge = (profile: Profile) => {
  const s = profile.idv_status;
  // "ID verified" is Stripe Identity's verdict only (owner 2026-10-21):
  // idv_status = 'verified'. Payout setup (Connect's stripe_identity_verified)
  // is NOT an ID check and never earns this badge. Admins still see the route
  // (Q2201): an admin approval is named as such, never as Stripe's answer.
  if (s === "verified") {
    return profile.legacy_manual_review
      ? <Badge className="bg-primary/10 text-primary border-primary/20 text-ds-10 gap-0.5"><ShieldCheck className="w-2.5 h-2.5" />ID verified by admin</Badge>
      : <Badge className="bg-primary/10 text-primary border-primary/20 text-ds-10 gap-0.5"><ShieldCheck className="w-2.5 h-2.5" />ID verified by Stripe</Badge>;
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
  // "Stripe ID", not a bare "Not Verified" (owner, 2026-10-08: "i thought that
  // meant email and i was confused"): it is the Stripe ID check, and email is not it.
  return <Badge variant="outline" className="text-muted-foreground text-ds-10 gap-0.5"><ShieldAlert className="w-2.5 h-2.5" />Stripe ID Not Verified</Badge>;
};
