import { useNavigate } from "react-router-dom";

/**
 * Board 177's two doors from You → Money: "Payout history" (bank payouts, each
 * opening what it carried) and "Receipts" (what left your card, fees owed, tax
 * forms). Payout history is offered only once payouts are set up: without a
 * payout account there are no bank payouts to list.
 */
export function MoneyRecordRows({ showPayouts }: { showPayouts: boolean }) {
  const navigate = useNavigate();
  const rows = [
    ...(showPayouts ? [{ key: "payout_history", title: "Payout history", sub: "Each bank payout and what it carried" }] : []),
    { key: "receipts", title: "Receipts", sub: "What you paid, amounts owed and tax forms" },
  ];
  return (
    <div className="space-y-2" data-money-record-rows="">
      {rows.map((r) => (
        <button
          key={r.key}
          type="button"
          onClick={() => navigate(`/profile?tab=${r.key}`)}
          className="w-full rounded-2xl liquid-glass px-4 py-3 flex items-center gap-3 text-left active:scale-[0.99] transition-transform"
        >
          <span className="min-w-0 flex-1">
            <span className="block text-ds-13 font-semibold" style={{ color: "hsl(var(--ink-deep))" }}>{r.title}</span>
            <span className="block text-ds-11 mt-0.5" style={{ color: "hsl(var(--olivewood) / 0.7)" }}>{r.sub}</span>
          </span>
          <span className="text-ds-13 shrink-0" style={{ color: "hsl(var(--olivewood) / 0.7)" }} aria-hidden="true">&rsaquo;</span>
        </button>
      ))}
    </div>
  );
}
