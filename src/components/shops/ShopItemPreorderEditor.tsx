/**
 * The shop's preorder settings for one saved item (migration 20261108184654; owner 11-08), below the item editor on
 * /shops/mine. Ready-by (tomorrow to 120 days out), an optional goal (a number ordered by a date), an optional limit,
 * and, once buyers have ordered, the one push of ready-by (at most 30 days; every buyer is told and may cancel for a
 * full refund). The server decides every rule (shops_set_item_preorder, shops_push_preorder_date) and this shows its
 * words; settings can't change while preorders are open (preorder_running).
 */
import { useId, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { DatePickerField } from "@/components/DatePickerField";
import { BrandConfirmDialog } from "@/components/ui/BrandConfirmDialog";
import { shopsErrorMessage } from "@/lib/shops/errors";
import {
  addDays,
  fetchItemPreorders,
  goalProgressText,
  louisianaToday,
  PREORDER_LATE_DAYS,
  PREORDER_MAX_DAYS,
  PREORDER_MAX_PUSH_DAYS,
  preorderLabel,
  pushPreorderDate,
  setItemPreorder,
  shortDate,
  type ItemPreorder,
} from "@/lib/shops/preorders";
import type { ShopItem } from "@/lib/shops/items";

const PREORDER_KINDS: readonly string[] = ["made", "home_food", "farm"];

/** The settings the shop is typing (strings, as the boxes hold them). */
interface Form { readyBy: string; withGoal: boolean; goal: string; goalBy: string; withCap: boolean; cap: string }

const formFrom = (p: ItemPreorder | null): Form => ({
  readyBy: p?.ready_by ?? "",
  withGoal: p?.goal != null,
  goal: p?.goal != null ? String(p.goal) : "",
  goalBy: p?.goal_by ?? "",
  withCap: p?.cap != null,
  cap: p?.cap != null ? String(p.cap) : "",
});

/** A whole number from a box, or the server's own refusal code (never a silent 0). */
function whole(s: string, code: string): number {
  if (!/^\d+$/.test(s.trim())) throw new Error(code);
  return Number(s.trim());
}

export default function ShopItemPreorderEditor({ shopId, item, hasOptions }: { shopId: string; item: ShopItem; hasOptions: boolean }) {
  const qc = useQueryClient();
  const headId = useId();
  const today = louisianaToday();
  const preorders = useQuery({ queryKey: ["shops", "item-preorders", shopId], queryFn: () => fetchItemPreorders(shopId) });
  const current = preorders.data?.get(item.id) ?? null;
  const [editing, setEditing] = useState(false);
  const [f, setF] = useState<Form>(() => formFrom(null));
  const [pushTo, setPushTo] = useState("");
  const [confirmPush, setConfirmPush] = useState(false);
  const set = <K extends keyof Form>(k: K, v: Form[K]) => setF((x) => ({ ...x, [k]: v }));
  const refresh = () => void qc.invalidateQueries({ queryKey: ["shops", "item-preorders", shopId] });

  const save = useMutation({
    mutationFn: (off: boolean) => setItemPreorder(item.id, off ? null : {
      readyBy: f.readyBy,
      goal: f.withGoal ? whole(f.goal, "preorder_goal") : null,
      goalBy: f.withGoal ? f.goalBy || null : null,
      cap: f.withCap ? whole(f.cap, "preorder_cap") : null,
    }),
    onSuccess: (_v, off) => {
      toast(off ? "Preorder turned off." : "Preorder saved. Buyers can preorder it now.");
      setEditing(false);
      refresh();
    },
    onError: (err) => toast.error(shopsErrorMessage(err)),
  });
  const push = useMutation({
    mutationFn: () => pushPreorderDate(item.id, pushTo),
    onSuccess: (n) => {
      toast(n > 0 ? `Date moved. ${n === 1 ? "1 buyer was" : `${n} buyers were`} told.` : "Date moved.");
      setConfirmPush(false);
      setPushTo("");
      refresh();
    },
    onError: (err) => {
      toast.error(shopsErrorMessage(err));
      setConfirmPush(false);
    },
  });

  if (!PREORDER_KINDS.includes(item.kind)) return null;
  const blocked = hasOptions ? "Items with options can't be preordered yet."
    : item.stock_count != null ? "Turn off \"I have some ready now\" and save, then you can sell it as a preorder." : null;
  const busy = save.isPending || push.isPending;

  return (
    <section className="space-y-3 rounded-2xl border border-border p-4" aria-labelledby={headId} data-testid="shop-item-preorder">
      <div className="space-y-1">
        <h3 id={headId} className="text-base font-semibold">Preorder</h3>
        <p className="text-ds-11 text-muted-foreground">
          Sell it before it's made. Buyers pay in full when they order, and you make it by your ready-by date.
        </p>
      </div>
      {preorders.isLoading ? (
        <p className="text-ds-13 text-muted-foreground" role="status">Loading…</p>
      ) : preorders.isError ? (
        <div role="alert" className="space-y-2">
          <p className="text-ds-13">{shopsErrorMessage(preorders.error)}</p>
          <Button type="button" size="sm" variant="outline" onClick={() => void preorders.refetch()}>Try again</Button>
        </div>
      ) : current && !editing ? (
        <div className="space-y-2">
          <p className="text-ds-13 font-semibold">{preorderLabel(current)}</p>
          {goalProgressText(current) && <p className="text-ds-13">{goalProgressText(current)}</p>}
          <p className="text-ds-11 text-muted-foreground">
            {current.cap != null ? `Limit: ${current.cap}. ` : ""}{`${current.ordered} ordered so far.`}
            {current.moved ? " You moved the date once already." : ""}
          </p>
          <div className="flex flex-wrap gap-2">
            <Button type="button" size="sm" variant="outline" disabled={busy} onClick={() => { setF(formFrom(current)); setEditing(true); }}>
              Change
            </Button>
            <Button type="button" size="sm" variant="outline" disabled={busy} onClick={() => save.mutate(true)}>Turn off</Button>
          </div>
          <p className="text-ds-11 text-muted-foreground">You can change or turn off a preorder only while nobody has an open order for it.</p>
          {!current.moved && !current.goal_missed && current.ordered > 0 && (
            <div className="space-y-1.5 border-t border-border pt-3">
              <Label htmlFor={`${headId}-push`}>Need more time? Move ready-by once</Label>
              <DatePickerField
                id={`${headId}-push`}
                value={pushTo}
                onChange={setPushTo}
                min={addDays(current.ready_by, 1)}
                isDateDisabled={(iso) => iso > addDays(current.ready_by, PREORDER_MAX_PUSH_DAYS)}
                placeholder="Pick the new date"
              />
              <p className="text-ds-11 text-muted-foreground">
                {`Up to ${PREORDER_MAX_PUSH_DAYS} days later, once. Every buyer is told and can cancel for a full refund, and what the card company keeps on those refunds comes out of your next payout.`}
              </p>
              <Button type="button" size="sm" variant="outline" disabled={busy || !pushTo} onClick={() => setConfirmPush(true)}>
                Move the date
              </Button>
            </div>
          )}
        </div>
      ) : blocked && !current ? (
        <p className="text-ds-13 text-muted-foreground" data-testid="shop-item-preorder-blocked">{blocked}</p>
      ) : !editing ? (
        <Button type="button" size="sm" variant="outline" onClick={() => { setF(formFrom(null)); setEditing(true); }}>
          Sell as a preorder
        </Button>
      ) : (
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor={`${headId}-ready`}>Ready by</Label>
            <DatePickerField
              id={`${headId}-ready`}
              value={f.readyBy}
              onChange={(v) => set("readyBy", v)}
              min={addDays(today, 1)}
              isDateDisabled={(iso) => iso > addDays(today, PREORDER_MAX_DAYS)}
              placeholder="Pick the day it will be ready"
            />
            <p className="text-ds-11 text-muted-foreground">{`Up to ${PREORDER_MAX_DAYS} days out.`}</p>
          </div>
          <Label htmlFor={`${headId}-goal-on`} className="flex min-h-11 items-start gap-2 font-normal leading-snug">
            <Checkbox id={`${headId}-goal-on`} checked={f.withGoal} onCheckedChange={(v) => set("withGoal", v === true)} />
            <span className="flex-1">Only make it if enough people order (a goal)</span>
          </Label>
          {f.withGoal && (
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor={`${headId}-goal`}>How many need to be ordered</Label>
                <Input id={`${headId}-goal`} type="number" inputMode="numeric" min={2} max={1000} value={f.goal}
                  placeholder="20" onChange={(e) => set("goal", e.target.value)} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor={`${headId}-goal-by`}>By</Label>
                <DatePickerField
                  id={`${headId}-goal-by`}
                  value={f.goalBy}
                  onChange={(v) => set("goalBy", v)}
                  min={today}
                  isDateDisabled={(iso) => !!f.readyBy && iso > f.readyBy}
                  placeholder="Goal date"
                />
              </div>
            </div>
          )}
          <Label htmlFor={`${headId}-cap-on`} className="flex min-h-11 items-start gap-2 font-normal leading-snug">
            <Checkbox id={`${headId}-cap-on`} checked={f.withCap} onCheckedChange={(v) => set("withCap", v === true)} />
            <span className="flex-1">Limit how many I take</span>
          </Label>
          {f.withCap && (
            <div className="space-y-1.5">
              <Label htmlFor={`${headId}-cap`}>Most I'll take</Label>
              <Input id={`${headId}-cap`} type="number" inputMode="numeric" min={1} max={1000} value={f.cap}
                placeholder="30" onChange={(e) => set("cap", e.target.value)} />
            </div>
          )}
          <div className="space-y-1 rounded-xl bg-muted/60 p-3 text-ds-11 text-muted-foreground" data-testid="shop-item-preorder-rules">
            <p>Buyers are charged in full when they order.</p>
            {f.withGoal && <p>If the goal isn't reached by its date, every buyer gets a full refund automatically, and you don't make it.</p>}
            <p>{`Mark each order ready by ${PREORDER_LATE_DAYS} days after ready-by, or that buyer gets a full refund automatically.`}</p>
            <p>On those refunds, what the card company keeps comes out of your next payout.</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button type="button" variant="ghost" disabled={busy} onClick={() => setEditing(false)}>Cancel</Button>
            <Button type="button" className="btn-grad-primary" disabled={busy || !f.readyBy} onClick={() => save.mutate(false)}>
              {save.isPending ? "Saving…" : "Save preorder"}
            </Button>
          </div>
        </div>
      )}
      <BrandConfirmDialog
        open={confirmPush}
        onOpenChange={(o) => { if (!o) setConfirmPush(false); }}
        title={pushTo ? `Move ready-by to ${shortDate(pushTo)}?` : "Move ready-by?"}
        description="You can do this only once. Every buyer is told and can cancel for a full refund; what the card company keeps on those refunds comes out of your next payout."
        primaryLabel={push.isPending ? "Moving…" : "Save the new date"}
        primaryDisabled={push.isPending}
        onPrimary={(e) => {
          e.preventDefault();
          push.mutate();
        }}
        secondaryLabel="Keep the date"
      />
    </section>
  );
}
