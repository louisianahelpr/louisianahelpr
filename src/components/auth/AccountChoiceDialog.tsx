// Q446 — one account per person. Shown when the auth server found no account
import { userFacingError } from "@/lib/userFacingError";
// for an Apple/Google sign-in and, by design, created none
// (public.hook_one_account_per_person). Before anything exists the person
// chooses: they already have an account (log in to it, then connect this
// provider in Profile > Security), or they are new (the account is made).
// Hide My Email is never refused (App Store guideline 4.8): it gets the same
// one question, with a line saying why we could not match it.
import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { BrandConfirmDialog } from "@/components/ui/BrandConfirmDialog";
import { hapticError } from "@/lib/haptics";
import { continueAsNewAccount, type AccountChoice } from "@/lib/socialAuth";

function providerName(choice: AccountChoice): string {
  if (choice.provider === "apple") return "Apple";
  if (choice.provider === "google") return "Google";
  return "Apple or Google";
}

/** Where "I already have an account" goes: log in, then Profile > Security. */
function connectAfterLoginHref(provider: AccountChoice["provider"]): string {
  const connect = provider ?? "any";
  const back = `/profile?tab=security&connect=${connect}`;
  return `/login?connect=${connect}&redirect=${encodeURIComponent(back)}`;
}

export function AccountChoiceDialog({
  choice,
  onDone,
  onChoice,
  redirectTo,
}: {
  choice: AccountChoice | null;
  /** Closes the dialog (choice made or dismissed). */
  onDone: () => void;
  /** A retried sign-in came back needing the choice again (a fresh row). */
  onChoice: (next: AccountChoice) => void;
  redirectTo?: string;
}) {
  const navigate = useNavigate();
  const [busy, setBusy] = useState(false);
  if (!choice) return null;
  const name = providerName(choice);

  const startNew = async (e: React.MouseEvent<HTMLButtonElement>) => {
    e.preventDefault(); // stay open while it runs
    if (busy) return;
    setBusy(true);
    const result = await continueAsNewAccount(choice, { redirectTo });
    switch (result.kind) {
      case "success": {
        onDone();
        navigate(redirectTo ? new URL(redirectTo, window.location.origin).pathname : "/home", { replace: true });
        return;
      }
      case "redirecting":
        return; // the browser is leaving for the provider
      case "marked":
        setBusy(false);
        onDone();
        toast(`Got it. Tap ${name} again to create your account.`, { id: "account-choice" });
        return;
      case "choose":
        setBusy(false);
        onChoice(result.choice);
        return;
      case "cancelled":
        setBusy(false);
        onDone();
        return;
      case "error":
        hapticError();
        setBusy(false);
        onDone();
        toast.error(userFacingError(result.message, "We couldn't finish that sign-in. Tap Apple or Google again to retry."), { id: "account-choice" });
        return;
    }
  };

  return (
    <BrandConfirmDialog
      open
      onOpenChange={(open) => {
        if (!open && !busy) onDone();
      }}
      title="Is this your first time here?"
      description={
        <>
          We didn&apos;t find a Louisiana Helpr account for this {name} sign-in, so we haven&apos;t made one.
          {choice.relay
            ? " You chose Hide My Email, so Apple shared a private address that can't match an account you made with your own email."
            : ""}{" "}
          If you already have an account, log in to it and connect {name}, so you keep one account with everything in it.
        </>
      }
      primaryLabel={busy ? "Creating…" : "I'm new here"}
      primaryDisabled={busy}
      primaryHaptic="none"
      onPrimary={startNew}
      secondaryLabel="I already have an account"
      onSecondary={() => {
        if (busy) return;
        onDone();
        navigate(connectAfterLoginHref(choice.provider));
      }}
    />
  );
}
