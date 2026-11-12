/**
 * A NEW listing's "Claude's listing" card (owner 2026-10-29: "ai should always be doing most of the work for
 * declutter listing"). Claude fills the form from the photos (SellAiDraft.tsx); this card shows what it wrote as
 * one row per field, each with its own "Edit <field>" that opens just that field in place, using the step form's
 * own controls (ChipGroup, the title box, the big price box). While Claude is writing the rows say so; when
 * Claude could not write it (or there are no photos yet), the empty rows say "Add …", so the screen never
 * dead-ends.
 */
import { useEffect, useRef, type ReactNode } from "react";
import type { DeliverySize } from "@/lib/declutter/api";
import { formatPrice } from "@/lib/declutter/distance";
import { SuggestCategory } from "@/components/SuggestCategory";
import { ChipGroup } from "./DeclutterSellSteps";
import PriceHint from "./DeclutterPriceHint";
import { AiPriceLine } from "./SellAiDraft";
import { CATEGORY_GROUPS, CATEGORY_LABEL, CONDITION_LABEL, SIZE_LABEL } from "./declutterUi";
import { CategoryDrillDown } from "./CategoryDrillDown";
import { FieldLabel, SELL_INPUT, SellPriceInput, SellYouGet } from "./SellFormParts";
import { SellTradesRow } from "./SellTradesRow";
import "@/lib/i18n/enDeclPanels";
import "@/lib/i18n/enSellSummary";
import { t, useLanguage } from "@/lib/i18n/language";
import type { MsgKey } from "@/lib/i18n/en";
import type { SellFlow } from "./useSellFlowState";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export type SummaryField = "title" | "price" | "category" | "condition" | "size" | "description";

/** F260q: the field's name in an Edit/Add button ("Edit price"), in the member's language. */
const fieldWord = (f: SummaryField) => t(`sell.field.${f}`);

function Row({ field, title, value, empty, open, onToggle, busy, children, extra, problem, instead }: {
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
  /** In place of Edit: a row with nothing to edit says what the seller can do instead (a free item's price). */
  instead?: { label: string; onClick: () => void };
}) {
  const verb = t(open ? "sell.done" : empty ? "sell.add" : "sell.edit");
  // Opening a row puts the cursor in it (audit posting 1030 #8): Edit, tap the box, type, Done was one tap too many.
  // Not the category search box (11-07): a phone keyboard would cover the headings the seller came to tap.
  const li = useRef<HTMLLIElement>(null);
  useEffect(() => {
    if (!open) return;
    li.current?.querySelector<HTMLElement>("input:not([type=checkbox]):not([type=search]), textarea, [role=radio][aria-checked=true]")?.focus();
  }, [open]);
  // Audit 11-10 F330: the written Details read as a bold heading; a paragraph of details is regular weight.
  return (
    <li ref={li} className="space-y-3 px-4 py-3.5" data-summary-row={field} data-sell-row={field}>
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <p id={`sell-row-${field}-title`} className="text-ds-13 font-semibold text-muted-foreground">{title}</p>
          {!open && (
            <p onClick={instead ? undefined : onToggle} className={`text-ds-15 [overflow-wrap:anywhere] ${instead ? "" : "cursor-pointer"} ${empty ? "text-muted-foreground" : field === "description" ? "text-foreground" : "font-semibold text-foreground"}`} data-summary-value="">
              {busy && empty ? t("sell.filling") : empty ? t(`sell.addField.${field}`) : value}
            </p>
          )}
        </div>
        {/* The name says which field ("Edit price"): an sr-only span's leading space is dropped from the computed name
            (it read "Editprice"), so the name is set whole; it starts with the visible word (labelInName). */}
        {instead ? (
          <Button type="button" variant="link" size="sm" onClick={instead.onClick} className="shrink-0 px-2 text-ds-14 font-bold text-[hsl(var(--sage-ink))]">{instead.label}</Button>
        ) : (
          <Button type="button" variant="link" size="sm" onClick={onToggle} aria-expanded={open} aria-label={`${verb} ${fieldWord(field)}`} className="shrink-0 px-2 text-ds-14 font-bold text-[hsl(var(--sage-ink))]">
            {verb}
          </Button>
        )}
      </div>
      {open && !instead && children}
      {problem}
      {extra}
    </li>
  );
}

export function SellSummaryCard({ s, open, setOpen, priceExtras, problems, settingsRows }: {
  s: SellFlow;
  /** The seller's settings as rows below Details (owner 2026-11-01: "included with the posting info"): SellingSettingsRows. */
  settingsRows?: ReactNode;
  open: SummaryField | null;
  setOpen: (u: (o: SummaryField | null) => SummaryField | null) => void;
  priceExtras: ReactNode;
  problems?: Partial<Record<SummaryField, ReactNode>>;
}) {
  const { form, set, ai, hintAt, priceCents, sizeKnown, setSizePicked } = s;
  useLanguage();
  const busy = ai.state.status === "busy";
  const toggle = (f: SummaryField) => setOpen((o) => (o === f ? null : f));
  const row = (field: SummaryField) => ({ field, open: open === field, onToggle: () => toggle(field), busy, problem: problems?.[field] });
  const draft = ai.state.status === "done" ? ai.state.draft : null;
  return (
    <section className="space-y-2" aria-labelledby="sell-summary-head">
      <h2 id="sell-summary-head" className="font-display font-moment text-ds-24 font-semibold leading-tight text-foreground">{t("sell.yourListing")}</h2>
      <p className="text-ds-14 text-muted-foreground">
        {t(busy ? "sell.writing" : draft ? "sell.wrote" : "sell.addPhotos")}
      </p>
      <ul className="divide-y divide-border overflow-hidden rounded-[20px] border border-border bg-card" aria-busy={busy} data-sell-summary={busy ? "busy" : draft ? "done" : "empty"}>
        <Row {...row("title")} title={t("sell.title")} value={form.title.trim()} empty={!form.title.trim()}>
          {/* Audit 11-10 F329: the row's own heading names the box (it read "Title" twice, a header and a label); a
              long pasted title was cut at 80 with no word, so the count shows and turns red at the limit. */}
          <div className="space-y-1.5">
            <Input look="card" id="sell-title" aria-labelledby="sell-row-title-title" maxLength={80} value={form.title} onChange={(e) => set("title", e.target.value)} placeholder={t("sell.titlePlaceholder")} />
            <p data-title-count="" className={`text-right text-ds-12 ${form.title.length >= 80 ? "font-semibold text-destructive-ink" : "text-muted-foreground"}`} aria-live="polite">
              {form.title.length}/80{form.title.length >= 80 ? t("sell.limit") : ""}
            </p>
          </div>
        </Row>
        <Row
          {...row("price")}
          title={t("sell.price")}
          value={form.free ? t("sell.free") : priceCents ? formatPrice(priceCents) : ""}
          empty={!form.free && !priceCents}
          instead={form.free ? { label: t("sell.chargeForIt"), onClick: () => { set("free", false); setOpen(() => "price"); } } : undefined}
          extra={<>
            {draft && !form.free && <AiPriceLine draft={draft} />}
            {!form.free && !!priceCents && <SellYouGet priceCents={priceCents} />}
            {!form.free && <PriceHint category={form.category} conditionStars={form.conditionStars} place="near_you" at={hintAt} />}
            {priceExtras}
          </>}
        >
          {!form.free && <SellPriceInput s={s} />}
        </Row>
        <Row {...row("category")} title={t("sell.category")} value={CATEGORY_LABEL[form.category] ? t(`decl.cat.${form.category}` as MsgKey) : form.category} empty={false}>
          <CategoryDrillDown label={t("sell.category")} groups={CATEGORY_GROUPS} value={form.category} onChange={(v) => { set("category", v); setOpen(() => null); }} />
          {/* I1 (Q1836 a): "Other" always works; this sends a missing category to the admin queue (hidden switch suggest_category). */}
          <SuggestCategory area="declutter" />
        </Row>
        <Row {...row("condition")} title={t("sell.condition")} value={CONDITION_LABEL[form.conditionStars] ? t(`decl.cond.${form.conditionStars}` as MsgKey) : ""} empty={false}>
          <ChipGroup label={t("sell.condition")} options={[5, 4, 3, 2, 1].map((n) => ({ value: String(n), label: t(`decl.cond.${n}` as MsgKey) }))} value={String(form.conditionStars)} onChange={(v) => set("conditionStars", Number(v))} />
        </Row>
        {/* Owner 11-08: "Open to trades?", one compact row below Condition (priced listings only). */}
        <SellTradesRow s={s} />
        {/* Not one of the owner's six: asked only when the photo tool didn't answer it (and while it is writing, never guessed). */}
        {!sizeKnown && !busy && (
          <Row {...row("size")} title={t("sell.size")} value="" empty>
            <ChipGroup label={t("sell.size")} options={(Object.keys(SIZE_LABEL) as DeliverySize[]).map((k) => ({ value: k, label: t(`decl.size.${k}`) }))} value="" onChange={(v) => { set("deliverySize", v as DeliverySize); setSizePicked(true); }} />
          </Row>
        )}
        <Row {...row("description")} title={t("sell.details")} value={form.description.trim()} empty={!form.description.trim()}>
          <div className="space-y-2">
            <FieldLabel htmlFor="sell-desc" text={t("sell.anythingElse")} extra={t("sell.optional")} />
            <Textarea id="sell-desc" className={`${SELL_INPUT} h-auto py-3`} rows={4} maxLength={2000} value={form.description} onChange={(e) => set("description", e.target.value)} placeholder={t("sell.detailsPlaceholder")} />
          </div>
        </Row>
        {settingsRows}
      </ul>
    </section>
  );
}
