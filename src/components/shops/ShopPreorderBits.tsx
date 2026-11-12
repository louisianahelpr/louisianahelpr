/**
 * Preorder words on the shop's page (migration 20261108184654): the item card's "Preorder · ready by Dec 15" with its
 * goal progress ("12 of 20 ordered · ends Dec 1"), and the plain charge and refund words the order sheet shows before
 * the buyer pays. The numbers are the server's (shops_item_preorders: paid items, not orders).
 */
import { goalProgressText, preorderChargeText, preorderClosedText, preorderLabel, type ItemPreorder } from "@/lib/shops/preorders";

/** The card's lines: the label, then a thin progress bar and the progress words when there is a goal. */
export function PreorderCardLines({ preorder }: { preorder: ItemPreorder }) {
  const progress = goalProgressText(preorder);
  const closed = preorderClosedText(preorder);
  const pct = preorder.goal ? Math.min(100, Math.round((preorder.ordered / preorder.goal) * 100)) : 0;
  return (
    <div className="space-y-1" data-testid="shop-item-preorder-line">
      <p className="text-ds-11 font-semibold text-foreground">{preorderLabel(preorder)}</p>
      {progress && preorder.goal != null && !preorder.goal_missed && (
        <div
          className="h-1.5 w-full overflow-hidden rounded-full bg-muted"
          role="progressbar"
          aria-label="Preorder goal"
          aria-valuemin={0}
          aria-valuemax={preorder.goal}
          aria-valuenow={Math.min(preorder.ordered, preorder.goal)}
        >
          <div className="h-full rounded-full bg-[hsl(var(--bark))]" style={{ width: `${pct}%` }} />
        </div>
      )}
      {progress && <p className="text-ds-11 text-muted-foreground">{progress}</p>}
      {closed && !preorder.goal_missed && <p className="text-ds-11 text-muted-foreground">{closed}</p>}
    </div>
  );
}

/** The order sheet's box: how a preorder is charged and when it is refunded, before the buyer pays. */
export function PreorderChargeBox({ preorder }: { preorder: ItemPreorder }) {
  const [first, ...rest] = preorderChargeText(preorder);
  return (
    <div className="space-y-1 rounded-xl bg-muted/60 p-3" data-testid="shop-order-preorder-terms">
      <p className="text-ds-13 font-semibold">{first}</p>
      {rest.map((line) => <p key={line} className="text-ds-11 text-muted-foreground">{line}</p>)}
    </div>
  );
}
