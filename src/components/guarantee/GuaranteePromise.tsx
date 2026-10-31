import { Link } from "react-router-dom";
import { ShieldCheck } from "lucide-react";
import { CardSubPanel } from "@/components/ui/CardSubPanel";
import {
  GUARANTEE_PROMISE_BODY,
  GUARANTEE_PROMISE_TITLE,
  GUARANTEE_TERMS_HREF,
  PAYMENT_HELD_LINE,
} from "@/lib/guarantee/promiseCopy";

/**
 * The Helpr Guarantee, said once, the same way everywhere it is offered
 * (first post's Review, /book/<id>). Copy lives in
 * src/lib/guarantee/promiseCopy.ts; built on the shared CardSubPanel.
 */
export function GuaranteePromise({ className }: { className?: string }) {
  return (
    <CardSubPanel icon={ShieldCheck} title={GUARANTEE_PROMISE_TITLE} tone="primary" className={className}>
      <div className="space-y-1.5 text-sm text-foreground" data-testid="guarantee-promise">
        <p>{GUARANTEE_PROMISE_BODY}</p>
        <p className="text-muted-foreground">{PAYMENT_HELD_LINE}</p>
        <Link to={GUARANTEE_TERMS_HREF} className="link-standard inline-block font-semibold">
          How it works
        </Link>
      </div>
    </CardSubPanel>
  );
}
