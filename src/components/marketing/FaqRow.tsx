import { useState } from "react";
import { ChevronDown } from "lucide-react";
import { ListRow } from "@/components/ui/ListRow";

/**
 * Shared editorial FAQ row — hairline divider between rows, chevron rotates on
 * open, no glass panel. Extracted from HelpCenter so any other
 * marketing surface can reuse the same pattern verbatim.
 *
 * The parent is responsible for grouping rows inside its own container /
 * squircle box; this component only owns one row's border + button + body.
 */
const FaqRow = ({
  q,
  a,
  defaultOpen = false,
}: {
  q: string;
  a: string;
  defaultOpen?: boolean;
}) => {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div
      className="border-b last:border-0"
      style={{ borderColor: "hsl(var(--olivewood) / 0.18)" }}
    >
      {/* The shared row (Q2709): its hover is the sanctioned tint, not a fade. -mx-3 cancels the row's px-3 so the
          question stays on the hairline's left edge and the tint reaches 12px past it on both sides. */}
      <ListRow
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className="-mx-3 w-[calc(100%+1.5rem)] items-start gap-6 py-5 sm:py-6"
        trailing={
          <ChevronDown
            className="w-5 h-5 shrink-0 mt-1 transition-transform duration-200"
            style={{
              color: "hsl(var(--olivewood))",
              transform: open ? "rotate(180deg)" : "rotate(0deg)",
            }}
            aria-hidden
          />
        }
      >
        <span
          className="font-sans font-semibold text-ds-15 sm:text-ds-17 leading-snug"
          style={{ color: "hsl(var(--ink-deep))" }}
        >
          {q}
        </span>
      </ListRow>
      {open && (
        <div className="pb-5 sm:pb-6 pr-8">
          <p
            className="font-sans text-ds-14 sm:text-ds-15 leading-relaxed"
            style={{ color: "hsl(var(--olivewood) / 0.9)" }}
          >
            {a}
          </p>
        </div>
      )}
    </div>
  );
};

export default FaqRow;
