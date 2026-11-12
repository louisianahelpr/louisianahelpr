/**
 * Sell a bunch: the one-time setup fee comes FIRST (audit finding 1). The server refuses a first PAID listing with
 * setup_fee_required_to_list, and before this the seller learned that only after every photo was sorted, uploaded and
 * drafted. declutter_setup_fee_due_cents is not callable by a member (proacl, read on prod 2026-10-30), so this mirrors
 * it from what a member can read: profiles.onboarding_fee_paid and get_public_platform_settings. It mirrors the
 * trigger's exemptions too (declutter_setup_fee_before_list: admins and seeded test accounts).
 * The server stays the protection; while either read is unanswered nothing is blocked, and a refusal still explains itself.
 * The trigger asks no fee at price 0, so free items carry on while it is due: only priced ones wait (bunchFreeOnly).
 * While the ID check is on for this seller the trigger asks for no card at all: the fee comes out of their payout once
 * items sell (owner 2026-10-30, 20261031002445), so there is nothing to pay here.
 */
import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { formatFeeLabel, useOnboardingFeeQuery } from "@/hooks/useOnboardingFee";
import { queryKeys } from "@/lib/queryKeys";
import { useIdentityCheckOnStore } from "@/lib/identityCheckSwitch";
import { payAccountSetupFee } from "@/lib/declutter/setupFee";
import { DeclutterNotice } from "./declutterUi";
import "@/lib/i18n/enListingParts";
import { t } from "@/lib/i18n/language";

/** The fee this seller must pay before a paid listing, in cents, or null when none is known to be due. */
export function useSetupFeeDueCents(): number | null {
  const { profile, isAdmin } = useCurrentUser();
  const fee = useOnboardingFeeQuery();
  const idCheckOn = useIdentityCheckOnStore();
  if (idCheckOn || !profile || profile.onboarding_fee_paid === true || isAdmin || profile.is_seed === true) return null;
  return fee.isSuccess ? fee.data ?? null : null;
}

export function BunchFeeGate({ cents }: { cents: number }) {
  const { user } = useCurrentUser();
  const qc = useQueryClient();
  const [opening, setOpening] = useState(false);

  async function pay() {
    setOpening(true);
    try {
      const outcome = await payAccountSetupFee();
      if (outcome === "already_paid") await qc.invalidateQueries({ queryKey: queryKeys.currentUser.byId(user?.id) });
    } finally {
      setOpening(false);
    }
  }

  return (
    <div data-bunch-fee-gate="">
      <DeclutterNotice tone="warn" title={t("lp.fg.title", { fee: formatFeeLabel(cents) })}>
        <p>
          {t("lp.fg.body")}
        </p>
        <p className="mt-1">
          {t("lp.fg.free")}
        </p>
        <Button type="button" size="sm" className="mt-3 rounded-full" disabled={opening} onClick={() => void pay()}>
          {opening ? t("lp.fg.opening") : t("lp.fg.pay", { fee: formatFeeLabel(cents) })}
        </Button>
      </DeclutterNotice>
    </div>
  );
}
