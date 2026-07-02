import { useState } from "react";
import { ChevronDown } from "lucide-react";
import type { FaqItem } from "./helpCenterContent";

// ─── FaqAccordionItem ─────────────────────────────────────────────────────────

const FaqAccordionItem = ({ q, a, defaultOpen = false }: FaqItem & { defaultOpen?: boolean }) => {
  const [open, setOpen] = useState(defaultOpen);

  return (
    <div
      className="border-b last:border-0"
      style={{ borderColor: "hsl(var(--olivewood) / 0.12)" }}
    >
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-start justify-between gap-3 py-4 text-left transition-opacity hover:opacity-80"
      >
        <span
          className="font-sans font-semibold text-ds-14 leading-snug"
          style={{ color: "hsl(var(--ink-deep))" }}
        >
          {q}
        </span>
        <ChevronDown
          className="w-4 h-4 shrink-0 mt-0.5 transition-transform duration-200"
          style={{
            color: "hsl(var(--olivewood))",
            transform: open ? "rotate(180deg)" : "rotate(0deg)",
          }}
          strokeWidth={2}
          aria-hidden
        />
      </button>
      {open && (
        <div className="pb-4">
          <p
            className="font-sans text-ds-13 leading-relaxed"
            style={{ color: "hsl(var(--olivewood))" }}
          >
            {a}
          </p>
        </div>
      )}
    </div>
  );
};

export default FaqAccordionItem;
