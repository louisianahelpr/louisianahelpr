import { useState } from "react";
import { Star } from "lucide-react";
import { hapticLight } from "@/lib/haptics";
import { STAR_ON } from "@/lib/starColor";

/**
 * The one star input (boards 35/36): five stars centred under the question,
 * OLIVE when chosen. They were burnt-sienna, which is the money colour
 * (HELPR-DESIGN-SPEC §1.1: rust is for prices, payouts and held money only).
 * `label` names the radiogroup for assistive tech; the visible question is the
 * card's own heading (ReviewQuestionCard).
 */
export const StarRow = ({
  value,
  onChange,
  label,
}: {
  value: number;
  onChange: (v: number) => void;
  label: string;
}) => {
  const [hover, setHover] = useState(0);
  return (
    <div
      className="flex justify-center gap-1"
      role="radiogroup"
      aria-label={label}
    >
      {[1, 2, 3, 4, 5].map((s) => {
        const lit = s <= (hover || value);
        return (
          <button
            key={s}
            type="button"
            role="radio"
            aria-checked={s === value}
            onClick={() => { hapticLight(); onChange(s); }}
            onMouseEnter={() => setHover(s)}
            onMouseLeave={() => setHover(0)}
            className="min-w-11 min-h-11 flex items-center justify-center active:scale-90 transition-transform"
            aria-label={`${s} star${s > 1 ? "s" : ""}`}
          >
            <Star
              className="w-8 h-8 transition-colors"
              strokeWidth={1.5}
              style={{
                color: lit ? STAR_ON : "hsl(var(--olivewood) / 0.25)",
                fill: lit ? STAR_ON : "transparent",
              }}
            />
          </button>
        );
      })}
    </div>
  );
};
