import { Label } from "@/components/ui/label";
import { RadioCardList } from "@/components/ui/RadioCardList";
import { hapticLight } from "@/lib/haptics";

export type JobTaxKind = "item_repair" | "fabric_cleaning" | "clothes_cleaning" | "clothing_alterations";

/**
 * Q2083 (owner Option 1, 2026-10-25): "at posting ask whether the job is repair
 * of a movable item, or cleaning of carpet / furniture / clothes (plus
 * alterations); tax only those". Louisiana taxes exactly that work among home
 * services (La. R.S. 47:301.3 item 5: laundry, cleaning, pressing, alterations
 * and the cleaning of clothing, linens, furniture, carpets and rugs; item 7:
 * repairs of movable property). A category cannot tell it apart (a "cleaning"
 * job may be a house or a sofa; a "handyman" job may be a wall or a chair), so
 * the poster answers here. Shown outside auto and appliance repair (taxed
 * anyway); the answer is jobs.tax_kind and the checkout prices tax from it
 * (create-payment laborTaxCode, the same rule the checkout screen quotes).
 */
const OPTIONS: Array<{ value: JobTaxKind | null; label: string; sub: string }> = [
  { value: null, label: "None of these", sub: "House repairs, yard work, moving, errands, house cleaning and most other jobs." },
  { value: "item_repair", label: "It fixes an item", sub: "Something you can move: an appliance, furniture, a bike, electronics, a small engine or a vehicle." },
  { value: "fabric_cleaning", label: "It cleans carpet, rugs or furniture", sub: "Carpet, rug, upholstery or furniture cleaning." },
  { value: "clothes_cleaning", label: "It washes or cleans clothes", sub: "Laundry, ironing, dry cleaning, or washing linens." },
  { value: "clothing_alterations", label: "It alters clothes", sub: "Hemming, taking in, letting out or other tailoring." },
];

/** RadioCardList values are strings; "none" stands for the NULL answer. */
const NONE = "none";

export function TaxKindQuestion({
  taxKind,
  setTaxKind,
}: {
  taxKind: JobTaxKind | null;
  setTaxKind: (next: JobTaxKind | null) => void;
}) {
  return (
    <div className="space-y-2.5" data-tax-kind-question="">
      <div className="space-y-0.5">
        <Label id="tax-kind-label">Is this one of these jobs?</Label>
        <p className="text-ds-11 font-sans leading-snug" style={{ color: "hsl(var(--olivewood) / 0.85)" }}>
          Louisiana charges sales tax on this kind of work. Checkout shows the tax before you pay.
        </p>
      </div>
      <RadioCardList
        label="Is this one of these jobs?"
        options={OPTIONS.map(({ value, label, sub }) => ({ value: value ?? NONE, label, sub }))}
        value={taxKind ?? NONE}
        onChange={(next, via) => {
          if (via === "click") hapticLight();
          setTaxKind(next === NONE ? null : (next as JobTaxKind));
        }}
      />
    </div>
  );
}
