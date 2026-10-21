import type { ChatReceipt } from "@/lib/jobSystemEvents";

const money = (cents: number) => `$${(cents / 100).toFixed(2)}`;

/**
 * Board 181: the payer's receipt in the deal room, once the job is done and
 * paid out. Every line is what was charged (deriveMoneyEvents reads the job's
 * stamped charge columns and the tip charge function); amounts in the money
 * colour (rust is for money only).
 */
export function ChatReceiptCard({ receipt }: { receipt: ChatReceipt }) {
  return (
    <div className="flex justify-start py-1" data-testid="chat-receipt">
      <section aria-label="Receipt" className="liquid-glass w-full max-w-[22rem] p-card flex flex-col gap-1.5">
        <h3 className="text-ds-12 font-semibold uppercase tracking-[0.08em] text-muted-foreground">Receipt</h3>
        <dl className="flex flex-col gap-1">
          {receipt.lines.map((l, i) => (
            <div key={`${l.label}-${i}`} className="flex items-baseline justify-between gap-3 text-ds-14">
              <dt className="text-foreground">{l.label}</dt>
              <dd className="font-semibold tabular-nums" style={{ color: "hsl(var(--sienna-ink))" }}>{money(l.cents)}</dd>
            </div>
          ))}
          <div className="flex items-baseline justify-between gap-3 border-t border-border/60 pt-2 mt-1">
            <dt className="text-ds-15 font-bold text-foreground">Total</dt>
            <dd className="text-ds-18 font-bold tabular-nums" style={{ color: "hsl(var(--sienna-ink))" }}>{money(receipt.totalCents)}</dd>
          </div>
        </dl>
      </section>
    </div>
  );
}
