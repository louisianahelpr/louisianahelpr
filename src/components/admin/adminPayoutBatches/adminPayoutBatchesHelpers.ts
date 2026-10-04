import { toneBadgeClasses } from "@/components/admin/tones";

export const LEDGER_TONE: Record<string, string> = {
  paid: toneBadgeClasses.success,
  pending: toneBadgeClasses.warning,
  failed: "bg-destructive/10 text-destructive",
  reversed: toneBadgeClasses.neutral,
};

// Payout holds are no longer kept here. They lived in this browser's
// localStorage ("helpr.admin_payout_holds.v1"), which no other admin and no
// payout function could see; they are now public.payout_holds, read and
// written in AdminPayoutBatches.tsx and honoured server-side (docs/OPEN.md
// Q764). An old localStorage entry is simply ignored.
