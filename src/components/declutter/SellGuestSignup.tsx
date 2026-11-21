/**
 * Owner 2026-11-21 (src/lib/guestSellDraft.ts): a guest fills the listing first; at Post they see this step instead of
 * posting. The listing is already on the device (useSellSaved), so the step says so, and "Create free account" goes to
 * sign-up with the way back (/declutter/sell?resume=draft). Sign-up offers Apple and Google as well; each spends the
 * same redirect (rememberSignupRedirect -> postAuthDestination). An existing member logs in to the same way back.
 */
import { useState } from "react";
import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { GUEST_SELL_LOGIN_URL } from "@/lib/guestSellDraft";
import "@/lib/i18n/enSellForm";
import { t as tr } from "@/lib/i18n/language";

export function SellGuestSignup({ onCreate }: { onCreate: () => Promise<void> }) {
  const [going, setGoing] = useState(false);
  return (
    <section role="status" aria-labelledby="sell-guest-head" className="space-y-3 rounded-[20px] border border-border bg-card p-4" data-sell-guest-signup="">
      <h2 id="sell-guest-head" className="text-base font-semibold text-foreground">{tr("sf.gu.head")}</h2>
      <p className="text-ds-14 text-muted-foreground">{tr("sf.gu.body")}</p>
      <Button
        type="button"
        className="w-full rounded-full"
        disabled={going}
        data-sell-guest-create=""
        onClick={() => {
          setGoing(true);
          // finishAsGuest never rejects (a failed device write is said on the screen by useDeviceSaved's note).
          void onCreate().finally(() => setGoing(false));
        }}
      >
        {tr("sf.gu.create")}
      </Button>
      <Button asChild variant="link" size="wrapSm" className="w-full justify-center font-semibold text-[hsl(var(--sage-ink))]">
        <Link to={GUEST_SELL_LOGIN_URL} data-sell-guest-login="">{tr("sf.gu.logIn")}</Link>
      </Button>
    </section>
  );
}
