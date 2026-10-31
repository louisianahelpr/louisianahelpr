/**
 * One item on Sell a bunch's review list, as a compact row (audit 10-30, finding 2: a full form per item was 913 px at
 * 375, so List sat 8,266 px down with six items). Its picture, name, one line of category and condition, and its price
 * in place, so a seller can go down the list pricing with the keyboard's Next. Tap to open the whole form.
 * A flagged item starts open, so its notice is read.
 */
import { ChevronDown } from "lucide-react";
import { Checkbox } from "@/components/ui/checkbox";
import { bunchItemProblem, type BunchItem } from "@/lib/declutter/bunch";
import { CATEGORY_LABEL, CONDITION_LABEL } from "./declutterUi";
import { bunchItemName } from "./DeclutterBunchCard";
import { FallbackImg } from "./FallbackImg";

export function BunchRow({ item, index, url, open, chosen, nextPriceId, onToggleOpen, onToggleChosen, onPrice, children }: {
  item: BunchItem;
  index: number;
  url: string | undefined;
  open: boolean;
  chosen: boolean;
  /** Where Next on the keyboard goes: the next item's price. */
  nextPriceId: string | null;
  onToggleOpen: () => void;
  onToggleChosen: (on: boolean) => void;
  onPrice: (price: string) => void;
  children: React.ReactNode;
}) {
  const name = bunchItemName(item, index);
  const problem = bunchItemProblem(item);
  const nameId = `row-name-${item.key}`;
  const toNext = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key !== "Enter") return;
    e.preventDefault();
    if (nextPriceId) document.getElementById(nextPriceId)?.focus();
    else e.currentTarget.blur();
  };
  return (
    <li className="rounded-[20px] border border-border bg-card" data-bunch-item="" data-bunch-row={item.key} data-flagged={item.flagged ? "" : undefined}>
      <div className="flex items-center gap-2 p-2">
        <Checkbox className="ml-1 shrink-0" checked={chosen} onCheckedChange={(v) => onToggleChosen(v === true)} aria-label={`Choose ${name}`} />
        <button type="button" onClick={onToggleOpen} aria-expanded={open} aria-label={`${open ? "Close" : "Open"} ${name}`} data-bunch-expand=""
          className="flex min-h-14 min-w-0 flex-1 items-center gap-2 rounded-xl text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
          <span className="h-14 w-14 shrink-0 overflow-hidden rounded-xl bg-photo-empty">
            {url?.startsWith("blob:") && <FallbackImg src={url} alt="" loading="lazy" decoding="async" className="h-14 w-14 object-cover" data-bunch-row-thumb="" />}
          </span>
          <span className="min-w-0 flex-1">
            <span id={nameId} className="block break-words text-ds-14 font-semibold">{name}</span>
            <span className="block truncate text-ds-12 text-muted-foreground">{CATEGORY_LABEL[item.category] ?? "Other"} · {CONDITION_LABEL[item.conditionStars]}</span>
            {!open && problem && <span className="block truncate text-ds-12 font-medium text-foreground" data-bunch-row-problem="">{problem}</span>}
          </span>
          <ChevronDown className={`h-4 w-4 shrink-0 text-muted-foreground transition-transform ${open ? "rotate-180" : ""}`} aria-hidden />
        </button>
        {!open && (item.free ? (
          <span className="w-[4.5rem] shrink-0 text-center text-ds-14 font-semibold" data-bunch-row-free="">Free</span>
        ) : (
          <input id={`price-${item.key}`} aria-label="Price ($)" aria-describedby={nameId} className="h-11 w-[4.5rem] shrink-0 rounded-2xl border border-input glass-field px-2 text-center text-ds-15"
            inputMode="decimal" enterKeyHint="next" value={item.price} placeholder="$" onChange={(e) => onPrice(e.target.value)} onKeyDown={toNext} />
        ))}
      </div>
      {open && <div className="border-t border-border">{children}</div>}
    </li>
  );
}
