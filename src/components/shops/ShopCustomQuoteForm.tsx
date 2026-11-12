/**
 * Custom orders (20261106205852): the shop answers a buyer's request with a price. It names what it is making (the
 * same kind and type picker as an item, never a rental) and ticks the same seller statements as listing that kind
 * (lead 11-06: e.g. the cottage-food statements for home food), plus this year's home-kitchen confirmation when it
 * has not been given. The server checks every rule again (shops_quote_custom_request); nothing here is the protection.
 */
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import {
  confirmCottageYear,
  fetchCottageStatus,
  requiredStatements,
  serviceTypeHint,
  SHOP_ITEM_KIND_LABEL,
  SHOP_ITEM_STATEMENTS,
  SHOP_ITEM_TYPE_LABEL,
  SHOP_ITEM_TYPES,
  type ShopItemKind,
} from "@/lib/shops/items";
import { quoteCustomRequest } from "@/lib/shops/customRequests";
import { SHOP_ITEM_MAX_PRICE_CENTS, shopsErrorMessage } from "@/lib/shops/errors";

/** The kinds a price can be for (shops_quote_custom_request refuses a rental: S5). */
const CUSTOM_QUOTE_KINDS: readonly ShopItemKind[] = ["made", "home_food", "farm", "service"];
const NOTE_MAX = 500;
const dollars = (c: number) => `$${(c / 100).toLocaleString("en-US")}`;

/** "$12.50" -> 1250; null for anything that is not a positive amount with at most 2 decimals. */
export function quoteCents(raw: string): number | null {
  const t = raw.trim().replace(/^\$/, "").replace(/,/g, "");
  if (!/^\d+(\.\d{1,2})?$/.test(t)) return null;
  const c = Math.round(Number(t) * 100);
  return c > 0 ? c : null;
}

export default function ShopCustomQuoteForm({ requestId, onDone }: { requestId: string; onDone: () => void }) {
  const qc = useQueryClient();
  const [kind, setKind] = useState<ShopItemKind>("made");
  const [subtype, setSubtype] = useState<string>(SHOP_ITEM_TYPES.made[0]);
  const [price, setPrice] = useState("");
  const [note, setNote] = useState("");
  const [ticked, setTicked] = useState<string[]>([]);
  const [underCap, setUnderCap] = useState(false);
  const cottage = useQuery({ queryKey: ["shops", "cottage"], queryFn: fetchCottageStatus, enabled: kind === "home_food" });
  const need = requiredStatements(kind, subtype);
  const cents = quoteCents(price);
  const priceOk = cents !== null && cents >= 100 && cents <= SHOP_ITEM_MAX_PRICE_CENTS;
  const cottageNeedsTick = kind === "home_food" && !!cottage.data && !cottage.data.confirmed;
  // Home food cannot be priced until the yearly status is known (as the item editor's Publish).
  const cottageUnknown = kind === "home_food" && !cottage.data;
  const cottageReached = kind === "home_food" && !!cottage.data?.reached;

  const send = useMutation({
    mutationFn: async () => {
      if (cottageNeedsTick) await confirmCottageYear();
      await quoteCustomRequest({ requestId, cents: cents as number, note, subtype, statements: need });
    },
    onSuccess: () => {
      toast("Price sent. The buyer has 7 days to order it; you then accept the order within 24 hours.");
      onDone();
    },
    onError: (err) => toast.error(shopsErrorMessage(err)),
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: ["shops", "custom-requests"] });
      void qc.invalidateQueries({ queryKey: ["shops", "cottage"] });
    },
  });

  const allTicked = need.every((k) => ticked.includes(k));
  const canSend = priceOk && allTicked && note.length <= NOTE_MAX && !cottageUnknown && !cottageReached
    && (!cottageNeedsTick || underCap) && !send.isPending;
  const id = (s: string) => `quote-${requestId}-${s}`;

  return (
    <div className="space-y-3 border-t border-border pt-3" data-testid="shop-custom-quote-form">
      <div className="space-y-1.5">
        <Label htmlFor={id("kind")}>What kind of order</Label>
        <NativeSelect
          id={id("kind")}
          value={kind}
          onChange={(e) => {
            const k = e.target.value as ShopItemKind;
            setKind(k);
            setSubtype(SHOP_ITEM_TYPES[k][0]);
            setTicked([]);
          }}
        >
          {CUSTOM_QUOTE_KINDS.map((k) => (
            <option key={k} value={k}>{SHOP_ITEM_KIND_LABEL[k]}</option>
          ))}
        </NativeSelect>
      </div>
      <div className="space-y-1.5">
        <Label htmlFor={id("type")}>Type</Label>
        <NativeSelect
          id={id("type")}
          value={subtype}
          onChange={(e) => {
            setSubtype(e.target.value);
            setTicked([]);
          }}
        >
          {SHOP_ITEM_TYPES[kind].map((t) => (
            <option key={t} value={t}>{SHOP_ITEM_TYPE_LABEL[t] ?? t}</option>
          ))}
        </NativeSelect>
        {serviceTypeHint(kind, subtype) && <p className="text-ds-11 text-muted-foreground">{serviceTypeHint(kind, subtype)}</p>}
      </div>
      <div className="space-y-1.5">
        <Label htmlFor={id("price")}>Price (dollars)</Label>
        <Input id={id("price")} inputMode="decimal" value={price} placeholder="40" onChange={(e) => setPrice(e.target.value)}
          aria-invalid={price !== "" && !priceOk} aria-describedby={id("price-help")} />
        <p id={id("price-help")} className="text-ds-11 text-muted-foreground">
          {`From $1 to ${dollars(SHOP_ITEM_MAX_PRICE_CENTS)}. The buyer's total adds any sales tax.`}
        </p>
      </div>
      <div className="space-y-1.5">
        <Label htmlFor={id("note")}>Note for the buyer (optional)</Label>
        <Textarea id={id("note")} value={note} maxLength={NOTE_MAX} onChange={(e) => setNote(e.target.value)}
          placeholder="What's included, and how long it takes" />
        <p className="text-ds-11 text-muted-foreground">{note.length}/{NOTE_MAX}. No phone numbers, emails or links.</p>
      </div>
      <fieldset className="space-y-2">
        <legend className="text-ds-13 font-medium">Before you send a price, confirm</legend>
        {need.map((k) => (
          <div key={k} className="flex items-start gap-2">
            <Checkbox
              id={id(`stmt-${k}`)}
              checked={ticked.includes(k)}
              onCheckedChange={(v) => setTicked((t) => (v === true ? [...t, k] : t.filter((x) => x !== k)))}
            />
            <Label htmlFor={id(`stmt-${k}`)} className="block min-h-11 flex-1 font-normal leading-snug">{SHOP_ITEM_STATEMENTS[k]}</Label>
          </div>
        ))}
        {cottageNeedsTick && (
          <div className="flex items-start gap-2">
            <Checkbox id={id("stmt-cottage")} checked={underCap} onCheckedChange={(v) => setUnderCap(v === true)} />
            <Label htmlFor={id("stmt-cottage")} className="block min-h-11 flex-1 font-normal leading-snug">
              {`My home-kitchen food sales this year, in the app and outside it, are under ${dollars(cottage.data?.cap_cents ?? 0)} (the Louisiana limit).`}
            </Label>
          </div>
        )}
        {cottageReached && (
          <p className="text-ds-11 text-destructive-ink">You've reached this year's home-kitchen limit. Home-kitchen prices can be sent again in January.</p>
        )}
        {kind === "home_food" && cottage.isError && (
          <p className="text-ds-11 text-destructive-ink">{shopsErrorMessage(cottage.error)}</p>
        )}
      </fieldset>
      <div className="flex flex-wrap gap-2">
        <Button type="button" variant="outline" disabled={send.isPending} onClick={onDone}>Cancel</Button>
        <Button type="button" className="btn-grad-primary" disabled={!canSend} onClick={() => send.mutate()}>
          {send.isPending ? "Sending…" : "Send price"}
        </Button>
      </div>
    </div>
  );
}
