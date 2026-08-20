import { useState } from "react";
import { Star } from "lucide-react";
import { hapticLight } from "@/lib/haptics";

export const StarRow = ({
  value,
  onChange,
  label,
  sublabel,
  optional,
}: {
  value: number;
  onChange: (v: number) => void;
  label: string;
  sublabel: string;
  /** Optional categories render a quiet "Optional" tag so users know
   *  they can skip them — only the Overall rating gates submission. */
  optional?: boolean;
}) => {
  const [hover, setHover] = useState(0);
  return (
    // Phone-width fix: side-by-side, the five 40px star targets (208px) plus
    // the card padding leave the label ~55px inside a 343px dialog, so the
    // label forced the row's min-content past the dialog width and the grid
    // track blew out — the 5th star and the body copy were clipped off-screen
    // (the dialog literally could not take a 5-star rating). Below `sm` the
    // label and the star row stack, so the stars always have their full
    // 208px and the label has the full card width to wrap into; from `sm` up
    // (where there is room) it stays the original single row.
    <div className="flex flex-col items-stretch gap-2 sm:flex-row sm:items-center sm:justify-between sm:gap-3 rounded-2xl liquid-glass p-3.5 min-w-0">
      <div className="flex-1 min-w-0">
        <p
          className="font-display italic font-bold leading-tight flex items-center gap-1.5 text-ds-15"
          style={{ color: "hsl(var(--ink-deep))", letterSpacing: "-0.012em" }}
        >
          {label}
          {optional && (
            <span
              className="font-serif italic text-ds-10"
              style={{ color: "hsl(var(--olivewood) / 0.8)", letterSpacing: "0.04em" }}
            >
              Optional
            </span>
          )}
        </p>
        <p
          className="font-serif italic mt-0.5 text-ds-12"
          style={{ color: "hsl(var(--olivewood) / 0.8)" }}
        >
          {sublabel}
        </p>
      </div>
      <div
        className="flex gap-0.5 shrink-0"
        role="radiogroup"
        aria-label={`${label} rating`}
      >
        {[1, 2, 3, 4, 5].map((s) => (
          <button
            key={s}
            type="button"
            role="radio"
            aria-checked={s === value}
            onClick={() => { hapticLight(); onChange(s); }}
            onMouseEnter={() => setHover(s)}
            onMouseLeave={() => setHover(0)}
            className="p-2 active:scale-90 transition-transform"
            aria-label={`${label} ${s} star${s > 1 ? "s" : ""}`}
          >
            <Star
              className="w-6 h-6 transition-colors"
              style={{
                color: s <= (hover || value) ? "hsl(var(--burnt-sienna))" : "hsl(var(--olivewood) / 0.25)",
                fill: s <= (hover || value) ? "hsl(var(--burnt-sienna))" : "transparent",
              }}
            />
          </button>
        ))}
      </div>
    </div>
  );
};
