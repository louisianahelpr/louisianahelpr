import { useRef } from "react";
import { Label } from "@/components/ui/label";
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

export function TaxKindQuestion({
  taxKind,
  setTaxKind,
}: {
  taxKind: JobTaxKind | null;
  setTaxKind: (next: JobTaxKind | null) => void;
}) {
  const rowRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const move = (from: number, delta: number) => {
    const next = (from + delta + OPTIONS.length) % OPTIONS.length;
    hapticLight();
    setTaxKind(OPTIONS[next].value);
    rowRefs.current[next]?.focus();
  };
  const onKeyDown = (e: React.KeyboardEvent<HTMLButtonElement>, index: number) => {
    if (e.key === "ArrowDown" || e.key === "ArrowRight") { e.preventDefault(); move(index, 1); }
    else if (e.key === "ArrowUp" || e.key === "ArrowLeft") { e.preventDefault(); move(index, -1); }
  };

  return (
    <div className="space-y-2.5" data-tax-kind-question="">
      <div className="space-y-0.5">
        <Label id="tax-kind-label">Is this one of these jobs?</Label>
        <p className="text-ds-11 font-sans leading-snug" style={{ color: "hsl(var(--olivewood) / 0.85)" }}>
          Louisiana charges sales tax on this kind of work. Checkout shows the tax before you pay.
        </p>
      </div>
      <div role="radiogroup" aria-labelledby="tax-kind-label" className="grid grid-cols-1 gap-1.5">
        {OPTIONS.map(({ value, label, sub }, index) => {
          const active = taxKind === value;
          return (
            <button
              key={label}
              ref={(el) => {
                rowRefs.current[index] = el;
              }}
              type="button"
              role="radio"
              aria-checked={active}
              tabIndex={active ? 0 : -1}
              onClick={() => {
                hapticLight();
                setTaxKind(value);
              }}
              onKeyDown={(e) => onKeyDown(e, index)}
              className={`flex w-full min-w-0 flex-col items-start gap-0.5 px-3 py-2.5 rounded-ds-md text-left transition-all active:scale-[0.99] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 ${
                active ? "btn-grad-primary" : ""
              }`}
              style={active ? undefined : { background: "hsl(var(--parchment))", color: "hsl(var(--ink-deep))" }}
            >
              <span className="text-ds-14 font-semibold leading-snug">{label}</span>
              <span className="text-ds-11 leading-snug" style={{ opacity: 0.85 }}>{sub}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
