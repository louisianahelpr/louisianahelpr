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

// A user only counts as "Pending Review" once their email is verified.
// Unverified-email users sit in a separate "Awaiting Email" bucket so admins
// aren't bothered until the user has actually confirmed their email.
export const isVerifiedEmail = (p: Profile) => !!p.email_verified;
export const isPendingReview = (p: Profile) =>
  p.approval_status === "pending" && isVerifiedEmail(p);
export const isAwaitingEmail = (p: Profile) =>
  p.approval_status === "pending" && !isVerifiedEmail(p);

// A pending user was "flagged by Stripe" if Stripe Identity returned a
// non-verified outcome (manual_review / failed) — these are the ones that
// need an explicit Override & Approve.
export const wasFlaggedByStripe = (p: Profile) => {
  const s = p.idv_status;
  return s === "manual_review" || s === "failed";
};

export const statusBadge = (profile: Profile) => {
  const banStatus = profile.ban_status || "active";
  if (banStatus === "permanently_banned") return <Badge className="bg-destructive/10 text-destructive text-ds-11">Permanently Banned</Badge>;
  if (banStatus === "temp_banned") return <Badge className="bg-destructive/10 text-destructive text-ds-11">Temp Banned</Badge>;
  // "warned" status is intentionally not surfaced as a status badge — the strike chip
  // ("1st Strike", "Final Warning", etc.) already conveys this without duplication.
  if (!isVerifiedEmail(profile)) return <Badge className="bg-accent/20 text-[hsl(var(--accent-ink))] text-ds-11">Pending Email Verification</Badge>;
  if (profile.approval_status === "approved") return <Badge className="bg-primary/10 text-primary text-ds-11">Active</Badge>;
  if (profile.approval_status === "denied") return <Badge className="bg-destructive/10 text-destructive text-ds-11">Denied</Badge>;
  return <Badge className="bg-accent/20 text-[hsl(var(--accent-ink))] text-ds-11">Pending Review</Badge>;
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
  if (s === "verified") {
    return <Badge className="bg-primary/10 text-primary border-primary/20 text-ds-10 gap-0.5"><ShieldCheck className="w-2.5 h-2.5" />Stripe Verified</Badge>;
  }
  // Only the values profiles_idv_status_check actually permits. "approved",
  // "requires_input" and "action_needed" were listed here and are all
  // unreachable — the constraint rejects every one of them.
  if (s === "manual_review" || s === "failed") {
    return <Badge className="bg-accent/20 text-[hsl(var(--accent-ink))] border-accent/30 text-ds-10 gap-0.5"><ShieldAlert className="w-2.5 h-2.5" />Stripe Flagged</Badge>;
  }
  return <Badge variant="outline" className="text-muted-foreground text-ds-10 gap-0.5"><ShieldAlert className="w-2.5 h-2.5" />ID Not Submitted</Badge>;
};
