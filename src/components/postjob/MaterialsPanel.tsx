import { useState } from "react";
import {
  ShoppingCart,
  ChevronDown,
  ChevronUp,
  Package,
  Layers,
  Circle,
  Maximize,
  Zap,
  Anchor,
  Droplets,
  Wind,
  Minus,
  Shield,
  Paintbrush,
  Trash2,
  Hand,
  Square,
  PenLine,
  Cloud,
  Wrench,
  ExternalLink,
} from "lucide-react";
import { categoryMaterials } from "@/lib/materialsGuide";
import type { LucideIcon } from "lucide-react";

/** Map of lucide icon name strings to their components. */
const ICON_MAP: Record<string, LucideIcon> = {
  Package,
  Layers,
  Circle,
  Maximize,
  Zap,
  Anchor,
  Droplets,
  Wind,
  Minus,
  Shield,
  Paintbrush,
  Trash2,
  Hand,
  Square,
  PenLine,
  Cloud,
  Wrench,
};

interface MaterialsPanelProps {
  category: string;
  className?: string;
}

export function MaterialsPanel({ category, className }: MaterialsPanelProps) {
  const [open, setOpen] = useState(false);

  const items = categoryMaterials[category];
  if (!items || items.length === 0) return null;

  return (
    <div
      className={className}
      style={{
        backgroundColor: "hsla(0, 0%, 100%, 0.45)",
        backdropFilter: "blur(16px)",
        WebkitBackdropFilter: "blur(16px)",
        border: "0.5px solid hsl(var(--border))",
        borderRadius: "var(--radius-ds-md, 12px)",
        overflow: "hidden",
      }}
    >
      {/* Header — always visible, tapping toggles body */}
      <button
        type="button"
        onClick={() => setOpen((prev) => !prev)}
        className="w-full flex items-center justify-between gap-3 px-4 py-3 text-left"
        aria-expanded={open}
      >
        <span className="flex items-center gap-2">
          <ShoppingCart
            className="w-4 h-4 shrink-0"
            style={{ color: "hsl(var(--primary))" }}
            strokeWidth={2.25}
          />
          <span
            className="font-display font-semibold text-ds-13"
            style={{ color: "hsl(var(--foreground))" }}
          >
            You might need:
          </span>
        </span>
        {open ? (
          <ChevronUp className="w-4 h-4 shrink-0" style={{ color: "hsl(var(--muted-foreground))" }} />
        ) : (
          <ChevronDown className="w-4 h-4 shrink-0" style={{ color: "hsl(var(--muted-foreground))" }} />
        )}
      </button>

      {/* Collapsible body */}
      {open && (
        <div className="px-4 pb-4 space-y-3">
          <div className="grid grid-cols-2 gap-2">
            {items.map((item) => {
              const Icon = ICON_MAP[item.icon] ?? Package;
              return (
                <div
                  key={item.name}
                  className="flex flex-col gap-1.5 rounded-ds-sm p-3"
                  style={{
                    background: "hsl(var(--secondary) / 0.35)",
                    border: "0.5px solid hsl(var(--border))",
                  }}
                >
                  <div className="flex items-center gap-1.5">
                    <Icon
                      className="w-3.5 h-3.5 shrink-0"
                      style={{ color: "hsl(var(--primary))" }}
                      strokeWidth={2.25}
                    />
                    <span
                      className="text-ds-12 font-medium leading-tight"
                      style={{ color: "hsl(var(--foreground))" }}
                    >
                      {item.name}
                    </span>
                  </div>
                  <span
                    className="text-ds-11"
                    style={{ color: "hsl(var(--muted-foreground))" }}
                  >
                    {item.estimatedCost}
                  </span>
                  <a
                    href={item.searchUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 text-ds-11 font-semibold mt-0.5 tap-44"
                    style={{ color: "hsl(var(--primary))" }}
                    onClick={(e) => e.stopPropagation()}
                  >
                    Shop <ExternalLink className="w-2.5 h-2.5" />
                  </a>
                </div>
              );
            })}
          </div>

          {/* Required affiliate disclosure */}
          <p
            className="text-ds-10 font-sans leading-snug"
            style={{ color: "hsl(var(--muted-foreground))" }}
          >
            Helpr may earn a small commission on purchases via these links.
          </p>
        </div>
      )}
    </div>
  );
}
