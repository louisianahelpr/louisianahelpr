/**
 * A NEW listing's "Claude's listing" card (owner 2026-10-29: "ai should always be doing most of the work for
 * declutter listing"). Claude fills the form from the photos (SellAiDraft.tsx); this card shows what it wrote as
 * one row per field, each with its own "Edit <field>" that opens just that field in place, using the step form's
 * own controls (ChipGroup, the title box, the big price box). While Claude is writing the rows say so; when
 * Claude could not write it (or there are no photos yet), the empty rows say "Add …", so the screen never
 * dead-ends.
 */
import type { ReactNode } from "react";
import type { DeliverySize } from "@/lib/declutter/api";
import { formatPrice } from "@/lib/declutter/distance";
import { ChipGroup } from "./DeclutterSellSteps";
import PriceHint from "./DeclutterPriceHint";
import { AiPriceLine } from "./SellAiDraft";
import { CATEGORY_LABEL, CONDITION_LABEL, SIZE_LABEL } from "./declutterUi";
import { FieldLabel, SELL_INPUT, SellPriceInput } from "./SellFormParts";
import type { SellFlow } from "./useSellFlowState";

export type SummaryField = "title" | "price" | "category" | "condition" | "size" | "description";

const FIELD_WORD: Record<SummaryField, string> = {
  title: "title",
  price: "price",
  category: "category",
  condition: "condition",
  size: "size",
  description: "details",
};

function Row({ field, title, value, empty, open, onToggle, busy, children, extra, problem }: {
  field: SummaryField;
  title: string;
  value: string;
  empty: boolean;
  open: boolean;
  onToggle: () => void;
  busy: boolean;
  children: ReactNode;
  extra?: ReactNode;
  /** What blocks Post in this row, once Post was tapped (audit DC-2: said in the row, not only by the button). */
  problem?: ReactNode;
}) {
  const verb = open ? "Done" : empty ? "Add" : "Edit";
  return (
    <li className="space-y-3 px-4 py-3.5" data-summary-row={field} data-sell-row={field}>
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <p className="text-ds-13 font-semibold text-muted-foreground">{title}</p>
          {!open && (
            <p className={`text-ds-15 [overflow-wrap:anywhere] ${empty ? "text-muted-foreground" : "font-semibold text-foreground"}`} data-summary-value="">
              {busy && empty ? "We're filling this in…" : empty ? `Add ${FIELD_WORD[field] === "details" ? "details" : `a ${FIELD_WORD[field]}`}` : value}
            </p>
          )}
        </div>
        {/* The name says which field ("Edit price"): an sr-only span's leading space is dropped from the computed name
            (it read "Editprice"), so the name is set whole; it starts with the visible word (labelInName). */}
        <button type="button" onClick={onToggle} aria-expanded={open} aria-label={`${verb} ${FIELD_WORD[field]}`} className="min-h-11 shrink-0 px-2 text-ds-14 font-bold text-[hsl(var(--sage-ink))]">
          {verb}
        </button>
      </div>
      {open && children}
      {problem}
      {extra}
    </li>
  );
}

export function SellSummaryCard({ s, open, setOpen, priceExtras, problems }: {
  s: SellFlow;
  open: SummaryField | null;
  setOpen: (u: (o: SummaryField | null) => SummaryField | null) => void;
  priceExtras: ReactNode;
  problems?: Partial<Record<SummaryField, ReactNode>>;
}) {
  const { form, set, ai, hintAt, priceCents } = s;
  const busy = ai.state.status === "busy";
  const toggle = (f: SummaryField) => setOpen((o) => (o === f ? null : f));
  const row = (field: SummaryField) => ({ field, open: open === field, onToggle: () => toggle(field), busy, problem: problems?.[field] });
  const draft = ai.state.status === "done" ? ai.state.draft : null;
  return (
    <section className="space-y-2" aria-labelledby="sell-summary-head">
      <h2 id="sell-summary-head" className="font-display font-moment text-ds-24 font-semibold leading-tight text-foreground">Your listing</h2>
      <p className="text-ds-14 text-muted-foreground">
        {busy ? "We're writing it from your photos." : draft ? "We wrote this from your photos. Change anything." : "Add photos and we'll write it for you, or fill it in yourself."}
      </p>
      <ul className="divide-y divide-border overflow-hidden rounded-[20px] border border-border bg-card" aria-busy={busy} data-sell-summary={busy ? "busy" : draft ? "done" : "empty"}>
        <Row {...row("title")} title="Title" value={form.title.trim()} empty={!form.title.trim()}>
          <div className="space-y-2">
            <FieldLabel htmlFor="sell-title" text="Title" />
            <input id="sell-title" className={SELL_INPUT} maxLength={80} value={form.title} onChange={(e) => set("title", e.target.value)} placeholder="e.g. Oak rocking chair" />
          </div>
        </Row>
        <Row
          {...row("price")}
          title="Price"
          value={form.free ? "Free" : priceCents ? formatPrice(priceCents) : ""}
          empty={!form.free && !priceCents}
          extra={<>
            {draft && !form.free && <AiPriceLine draft={draft} />}
            {!form.free && <PriceHint category={form.category} conditionStars={form.conditionStars} place="near_you" at={hintAt} />}
            {priceExtras}
          </>}
        >
          {!form.free && <SellPriceInput s={s} />}
        </Row>
        <Row {...row("category")} title="Category" value={CATEGORY_LABEL[form.category] ?? form.category} empty={false}>
          <ChipGroup label="Category" options={Object.entries(CATEGORY_LABEL).map(([k, v]) => ({ value: k, label: v }))} value={form.category} onChange={(v) => set("category", v)} />
        </Row>
        <Row {...row("condition")} title="Condition" value={CONDITION_LABEL[form.conditionStars] ?? ""} empty={false}>
          <ChipGroup label="Condition" options={[5, 4, 3, 2, 1].map((n) => ({ value: String(n), label: CONDITION_LABEL[n] }))} value={String(form.conditionStars)} onChange={(v) => set("conditionStars", Number(v))} />
        </Row>
        <Row {...row("size")} title="Size" value={SIZE_LABEL[form.deliverySize] ?? ""} empty={false}>
          <ChipGroup label="Size" options={(Object.keys(SIZE_LABEL) as DeliverySize[]).map((k) => ({ value: k, label: SIZE_LABEL[k] }))} value={form.deliverySize} onChange={(v) => set("deliverySize", v as DeliverySize)} />
        </Row>
        <Row {...row("description")} title="Details" value={form.description.trim()} empty={!form.description.trim()}>
          <div className="space-y-2">
            <FieldLabel htmlFor="sell-desc" text="Anything else?" extra="(optional)" />
            <textarea id="sell-desc" className={`${SELL_INPUT} h-auto py-3`} rows={4} maxLength={2000} value={form.description} onChange={(e) => set("description", e.target.value)} placeholder="e.g. Works great. Small scuff on the base." />
          </div>
        </Row>
      </ul>
    </section>
  );
}
