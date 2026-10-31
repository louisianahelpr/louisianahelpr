/**
 * One item on Sell a bunch's review list, as a compact row (audit 10-30, finding 2: a full form per item was 913 px at
 * 375, so List sat 8,266 px down with six items). Its picture, name, one line of category and condition, and its price
 * in place, so a seller can go down the list pricing with the keyboard's Next. Tap to open the whole form.
 * A flagged item starts open, so its notice is read. A photo dragged from another item (desktop width) can drop anywhere on it.
 */
import { useState } from "react";
import { ChevronDown } from "lucide-react";
import { bunchItemProblem, type BunchItem } from "@/lib/declutter/bunch";
import { CATEGORY_LABEL, CONDITION_LABEL } from "./declutterUi";
import { bunchItemName } from "./DeclutterBunchCard";
import { FallbackImg } from "./FallbackImg";
import { bunchPhotoDrag } from "./bunchPhotoDrag";

export function BunchRow({ item, index, url, open, nextPriceId, canDrop, onToggleOpen, onPrice, onPhotoDrop, children }: {
  item: BunchItem;
  index: number;
  url: string | undefined;
  open: boolean;
  /** Where Next on the keyboard goes: the next item's price. */
  nextPriceId: string | null;
  /** False while a run is working on the list: nothing moves under it. */
  canDrop: boolean;
  onToggleOpen: () => void;
  onPrice: (price: string) => void;
  onPhotoDrop: (photoKey: string) => void;
  children: React.ReactNode;
}) {
  const [dropOn, setDropOn] = useState(false);
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
    <li className={`rounded-[20px] border bg-card ${dropOn ? "border-[hsl(var(--bark))] ring-2 ring-[hsl(var(--bark))]" : "border-border"}`} data-bunch-item="" data-bunch-row={item.key} data-flagged={item.flagged ? "" : undefined} data-bunch-drop-on={dropOn ? "" : undefined}
      onDragOver={(e) => {
        const from = bunchPhotoDrag.current();
        // Only our own photo from another item: a file dragged in from the computer is left to the browser.
        if (!canDrop || !from || from.item === item.key) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = "move";
        setDropOn(true);
      }}
      onDragLeave={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setDropOn(false);
      }}
      onDrop={(e) => {
        setDropOn(false);
        const from = bunchPhotoDrag.current();
        if (!canDrop || !from || from.item === item.key) return;
        e.preventDefault();
        bunchPhotoDrag.end();
        onPhotoDrop(from.photo);
      }}>
      <div className="flex items-center gap-2 p-2">
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
