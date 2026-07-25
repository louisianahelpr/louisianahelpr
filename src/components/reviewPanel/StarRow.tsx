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
    <div className="flex items-center justify-between gap-3 rounded-2xl liquid-glass p-3.5">
      <div className="flex-1 min-w-0">
        <p
          className="font-display italic font-bold leading-tight flex items-center gap-1.5"
          style={{ fontSize: "0.92rem", color: "hsl(var(--ink-deep))", letterSpacing: "-0.012em" }}
        >
          {label}
          {optional && (
            <span
              className="font-serif italic"
              style={{ fontSize: "0.62rem", color: "hsl(var(--olivewood) / 0.8)", letterSpacing: "0.04em" }}
            >
              Optional
            </span>
          )}
        </p>
        <p
          className="font-serif italic mt-0.5"
          style={{ fontSize: "0.72rem", color: "hsl(var(--olivewood) / 0.8)" }}
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
