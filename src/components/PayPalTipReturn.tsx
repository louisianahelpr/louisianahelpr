/**
 * The poster's landing after paying a tip on PayPal. PayPal sends them back to
 * paypal-tip's return URL, `/posts?tip=paypal&token=<order id>` (PayPal appends
 * `token`), which /posts forwards to /jobs with its params; on the app, the
 * website in the sheet bounces the same URL home (nativeReturnBounce). This
 * captures the tip once (paypal-tip "capture"; the webhook does the same and
 * the server is idempotent), clears the params, tells the poster what
 * happened, and refreshes what the payment changed. Renders nothing.
 */
import { useEffect, useRef } from "react";
import { useSearchParams } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { finishPayPalTip, PayPalTipReturnRefused } from "@/lib/tipCheckout";
import { report } from "@/lib/errorLogger";
import { userFacingError } from "@/lib/userFacingError";

export function PayPalTipReturn() {
  const [params, setParams] = useSearchParams();
  const queryClient = useQueryClient();
  const handled = useRef<string | null>(null);
  const orderId = params.get("tip") === "paypal" ? params.get("token") : null;

  useEffect(() => {
    if (!orderId || handled.current === orderId) return;
    handled.current = orderId;
    void (async () => {
      // Only an ANSWER clears the order id from the URL. On a failure that may pass it stays, so the
      // refresh the message asks for captures again (the server is idempotent; the webhook also
      // finishes it). A final refusal (no such tip for this member) clears it too.
      const clear = () => setParams((prev) => {
        const p = new URLSearchParams(prev);
        for (const k of ["tip", "token", "PayerID"]) p.delete(k);
        return p;
      }, { replace: true });
      try {
        const res = await finishPayPalTip(orderId);
        clear();
        if (res.state === "paid") toast.success("Tip sent. All of it goes to your Helpr.");
        else if (res.state === "declined" && res.message) toast.error(res.message);
        else if (res.message) toast(res.message);
        await queryClient.invalidateQueries();
      } catch (err) {
        if (err instanceof PayPalTipReturnRefused) clear();
        // Reported and shown; unless final, the URL keeps the order id for the refresh.
        report(err, { tags: { source: "money.tip", action: "paypal_capture" }, context: { orderId } });
        toast.error(userFacingError(err, "We couldn't confirm your tip yet. Please don't tip again; refresh this page in a minute."));
      }
    })();
  }, [orderId, setParams, queryClient]);

  return null;
}
