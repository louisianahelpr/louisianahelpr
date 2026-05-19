import { Button } from "@/components/ui/button";

interface DraftPromptProps {
  onLoad: () => void;
  onDismiss: () => void;
}

/**
 * Draft Prompt — brand-aligned: liquid-glass surface, eyebrow,
 * font-display italic title, font-serif italic description. Lets the
 * poster resume a saved draft or start fresh.
 */
export function DraftPrompt({ onLoad, onDismiss }: DraftPromptProps) {
  return (
    <div className="rounded-2xl liquid-glass p-4 flex items-center justify-between gap-3">
      <div className="min-w-0">
        <p className="font-serif italic uppercase text-ds-9" style={{ color: "hsl(var(--burnt-sienna) / 0.78)", letterSpacing: "0.18em" }}>
          Picking up where you left off
        </p>
        <p className="font-display italic font-bold mt-1" style={{ fontSize: "1rem", color: "hsl(var(--ink-deep))", letterSpacing: "-0.01em" }}>
          You have a saved draft
        </p>
        <p className="font-serif italic mt-0.5 text-ds-11" style={{ color: "hsl(var(--olivewood) / 0.7)" }}>
          Pick up where you stopped, or start fresh.
        </p>
      </div>
      <div className="flex gap-2 shrink-0">
        <Button variant="outline" size="sm" onClick={onDismiss}>
          Start fresh
        </Button>
        <Button size="sm" onClick={onLoad}>
          Load draft
        </Button>
      </div>
    </div>
  );
}
