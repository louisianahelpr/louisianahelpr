/**
 * Publishes the `paypal_payments` switch for this viewer into the store (src/lib/paypalPaymentsSwitch.ts)
 * that the fee copy reads. Mounted once in App, next to IdentityCheckHost. Draws nothing.
 */
import { useEffect } from "react";
import { useFeatureStatus } from "@/hooks/useFeature";
import { setPayPalPaymentsSwitch } from "@/lib/paypalPaymentsSwitch";

export function PayPalSwitchHost() {
  const { on, settled } = useFeatureStatus("paypal_payments");
  useEffect(() => setPayPalPaymentsSwitch({ on, settled }), [on, settled]);
  return null;
}
