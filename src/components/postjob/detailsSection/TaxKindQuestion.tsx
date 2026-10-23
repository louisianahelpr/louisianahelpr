import { useRef } from "react";
import { Label } from "@/components/ui/label";
import { hapticLight } from "@/lib/haptics";

export type JobTaxKind = "item_repair" | "fabric_cleaning";

/**
 * Owner 2026-10-23 (#3555, "BOTH"): keep taxing the 14 taxed categories AND
 * tax the work the tax memo says Louisiana taxes (R.S. 47:301.3 items 5 and 7):
 * fixing an item, and cleaning carpet, rugs, furniture or clothes. A category
 * cannot tell those apart (a "cleaning" job may be a house or a sofa), so the
 * poster answers here. Shown only outside the 14 taxed categories; the answer
 * is jobs.tax_kind and the checkout prices tax from it (create-payment
 * laborTaxCode, the same rule the checkout screen quotes).
 */
const OPTIONS: Array<{ value: JobTaxKind | null; label: string; sub: string }> = [
  { value: null, label: "Neither", sub: "House, yard, moving, errands and most other jobs." },
  { value: "item_repair", label: "It fixes an item", sub: "An appliance, furniture, a bike, electronics, a small engine or a vehicle." },
  { value: "fabric_cleaning", label: "It cleans carpet, rugs, furniture or clothes", sub: "Upholstery, laundry, pressing or alterations." },
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
        <Label id="tax-kind-label">Does this job fix an item or clean fabric?</Label>
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
