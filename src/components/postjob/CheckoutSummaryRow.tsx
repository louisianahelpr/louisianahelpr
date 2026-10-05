import type { ReactNode } from "react";

/** One label / dollar-amount line of the checkout order summary (CheckoutStep). */
export function CheckoutSummaryRow({ label, amount, labelClassName }: { label: ReactNode; amount: string; labelClassName?: string }) {
  return (
    <div className="flex justify-between text-ds-13">
      <span className={labelClassName ? `text-muted-foreground ${labelClassName}` : "text-muted-foreground"}>{label}</span>
      <span className="font-medium text-foreground">${amount}</span>
    </div>
  );
}
