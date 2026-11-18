import type { ReactNode } from "react";
import { BrandConfirmDialog, type BrandPrimaryHaptic } from "@/components/ui/BrandConfirmDialog";
import { useSignOutAction, type SignOutActionOptions } from "@/hooks/useSignOutAction";
import { useLanguage } from "@/lib/i18n/language";
import { wordInLang } from "@/lib/i18n/inLang";

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
 * The confirm-then-sign-out dialog (Profile "Log Out?", Admin "Sign out?",
 * Security "Sign out everywhere?").
 *
 * Owner, 2026-10-09: "I pressed Log Out and nothing happened." The dialog used
 * to close on the press (BrandConfirmDialog's primary is a Dialog Close) while
 * sign-out ran unseen. Here the press keeps it open, the primary reads
 * "Logging out…" and is disabled until sign-out finishes, and Cancel / Escape /
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
  useLanguage();
  // Named before the JSX: the press sweep's commit-label reader takes every string in primaryLabel as a label.
  const loggingOut = wordInLang("acct.loggingOut", "Logging out…");
  return (
    <BrandConfirmDialog
      open={open}
      onOpenChange={(next) => { if (!signingOut) onOpenChange(next); }}
      title={title}
      description={description}
      primaryLabel={signingOut ? loggingOut : label}
      primaryDisabled={signingOut}
      primaryTone={primaryTone}
      primaryHaptic={primaryHaptic}
      onPrimary={(e) => {
        e.preventDefault();
        void signOut({ scope, after });
      }}
      secondaryLabel={wordInLang("acct.cancel", "Cancel")}
    />
  );
}

// Boot-path safe: wordInLang reads the Spanish chunk when it is loaded and never pulls the English dictionary in.
/**
 * You › Log out and the desktop photo menu's Log out: one confirm, in the member's language (design audit area 09
 * H1 + L6: "Log out" everywhere, never "sign back in" under a Log out button).
 */
export function LogOutConfirmDialog({ open, onOpenChange, after }: Pick<SignOutConfirmDialogProps, "open" | "onOpenChange" | "after">) {
  useLanguage();
  return (
    <SignOutConfirmDialog open={open} onOpenChange={onOpenChange} title={wordInLang("acct.logoutTitle", "Log out?")}
      description={wordInLang("acct.logoutBody", "You can log back in anytime. Your account stays as it is.")} label={wordInLang("acct.logout", "Log out")} after={after} />
  );
}
