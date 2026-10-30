/**
 * Changing many items at once on Sell a bunch (audit 10-30, finding 2): a price, a percent off our suggestions, free, or
 * a condition. With nothing ticked it changes every item, and says so on its own line first. Each change can be undone.
 */
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { CONDITION_LABEL } from "./declutterUi";

const field = "h-11 w-24 min-w-0 rounded-2xl border border-input glass-field px-3 text-ds-15";

type Action = "price" | "percent" | "condition";

export function BunchBulk({ total, chosen, onToggleAll, onSetPrice, onPercentOff, onFree, onCondition }: {
  total: number;
  chosen: number;
  onToggleAll: (on: boolean) => void;
  onSetPrice: (price: string) => void;
  onPercentOff: (pct: number) => void;
  onFree: () => void;
  onCondition: (stars: number) => void;
}) {
  const [action, setAction] = useState<Action | null>(null);
  const [value, setValue] = useState("");
  const [stars, setStars] = useState(4);
  const open = (a: Action) => { setValue(a === "percent" ? "20" : ""); setAction((x) => (x === a ? null : a)); };
  const pct = Number(value);
  const pctOk = Number.isInteger(pct) && pct >= 1 && pct <= 90;
  const priceOk = /^\d+(\.\d{1,2})?$/.test(value.replace(/[$,\s]/g, "")) && Number(value.replace(/[$,\s]/g, "")) >= 1 && Number(value.replace(/[$,\s]/g, "")) <= 1000;
  const pill = (a: Action, label: string) => (
    <Button type="button" variant="outline" size="sm" className="rounded-full" aria-expanded={action === a} onClick={() => open(a)}>{label}</Button>
  );
  return (
    <div className="space-y-2 rounded-2xl border border-border p-2" data-bunch-bulk="">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <label className="flex min-h-11 items-center gap-2 pl-1 text-ds-14 font-medium">
          <Checkbox checked={chosen === total} onCheckedChange={(v) => onToggleAll(v === true)} />
          Choose all
        </label>
        <p className="text-ds-13 text-muted-foreground" data-bunch-bulk-scope="">{chosen > 0 ? `These change the ${chosen} you chose.` : `These change all ${total}.`}</p>
      </div>
      <div className="flex flex-wrap gap-2">
        {pill("price", "Set price")}
        {pill("percent", "% off suggested")}
        <Button type="button" variant="outline" size="sm" className="rounded-full" onClick={() => { setAction(null); onFree(); }}>Make free</Button>
        {pill("condition", "Set condition")}
      </div>
      {action === "price" && (
        <form className="flex items-end gap-2" onSubmit={(e) => { e.preventDefault(); if (priceOk) { onSetPrice(value.replace(/[$,\s]/g, "")); setAction(null); } }}>
          <label className="block text-ds-13 font-medium">Price ($)
            <input className={`${field} block`} inputMode="decimal" enterKeyHint="done" aria-label="Price for these items ($)" value={value} onChange={(e) => setValue(e.target.value)} />
          </label>
          <Button type="submit" size="sm" className="rounded-full" disabled={!priceOk}>Apply</Button>
        </form>
      )}
      {action === "percent" && (
        <form className="flex items-end gap-2" onSubmit={(e) => { e.preventDefault(); if (pctOk) { onPercentOff(pct); setAction(null); } }}>
          <label className="block text-ds-13 font-medium">Percent off
            <input className={`${field} block`} inputMode="numeric" enterKeyHint="done" aria-label="Percent off our suggested prices" value={value} onChange={(e) => setValue(e.target.value)} />
          </label>
          <Button type="submit" size="sm" className="rounded-full" disabled={!pctOk}>Apply</Button>
        </form>
      )}
      {action === "condition" && (
        <div className="flex items-end gap-2">
          <label className="block min-w-0 flex-1 text-ds-13 font-medium">Condition
            <select className="block h-11 w-full min-w-0 rounded-2xl border border-input glass-field px-3 text-ds-15" aria-label="Condition for these items" value={stars} onChange={(e) => setStars(Number(e.target.value))}>
              {[5, 4, 3, 2, 1].map((s) => <option key={s} value={s}>{CONDITION_LABEL[s]}</option>)}
            </select>
          </label>
          <Button type="button" size="sm" className="rounded-full" onClick={() => { onCondition(stars); setAction(null); }}>Apply</Button>
        </div>
      )}
    </div>
  );
}
