import type { ReactNode } from "react";
import { BrandConfirmDialog, type BrandPrimaryHaptic } from "@/components/ui/BrandConfirmDialog";
import { useSignOutAction, type SignOutActionOptions } from "@/hooks/useSignOutAction";

interface SignOutConfirmDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: ReactNode;
  description: ReactNode;
  /** The primary button's label while idle ("Log Out", "Sign Out", ...). */
  label: string;
  primaryTone?: "bark" | "sienna";
  primaryHaptic?: BrandPrimaryHaptic;
  scope?: SignOutActionOptions["scope"];
  /** Runs once sign-out has finished: navigate away, or close and toast. */
  after: NonNullable<SignOutActionOptions["after"]>;
}

/**
 * The confirm-then-sign-out dialog (Profile "Log Out?", Admin "Sign Out?",
 * Security "Sign Out Everywhere?").
 *
 * Owner, 2026-10-09: "I pressed Log Out and nothing happened." The dialog used
 * to close on the press (BrandConfirmDialog's primary is a Dialog Close) while
 * sign-out ran unseen. Here the press keeps it open, the primary reads
 * "Logging Out…" and is disabled until sign-out finishes, and Cancel / Escape /
 * the overlay cannot close it mid-sign-out. `after` decides what happens next.
 */
export function SignOutConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  label,
  primaryTone = "bark",
  primaryHaptic = "medium",
  scope,
  after,
}: SignOutConfirmDialogProps) {
  const { signingOut, signOut } = useSignOutAction();
  return (
    <BrandConfirmDialog
      open={open}
      onOpenChange={(next) => { if (!signingOut) onOpenChange(next); }}
      title={title}
      description={description}
      primaryLabel={signingOut ? "Logging Out…" : label}
      primaryDisabled={signingOut}
      primaryTone={primaryTone}
      primaryHaptic={primaryHaptic}
      onPrimary={(e) => {
        e.preventDefault();
        void signOut({ scope, after });
      }}
      secondaryLabel="Cancel"
    />
  );
}
