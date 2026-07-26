import { hapticLight } from "@/lib/haptics";
import { cn } from "@/lib/utils";

/**
 * FirstMessageChips — three audience-tuned ice-breaker chips shown above
 * the composer when a conversation is brand-new (zero real messages).
 *
 * Tapping a chip populates the input (it does NOT auto-send) so the user
 * can edit or expand it before hitting send, and the row is dismissed for
 * the rest of the session via a parent-owned flag — once you've picked one,
 * the chips don't keep nagging.
 *
 * Chip text is keyed off `viewerRole`: customers (job posters) ask the
 * helper about timing / tools / proof; helpers introduce themselves and
 * confirm readiness. The role flag is derived upstream from the existing
 * `Conversation.viewerIsPoster` context — see `ChatView`.
 */

const CUSTOMER_CHIPS = [
  "When can you start?",
  "Do you have your own tools?",
  "Can you send a photo when done?",
] as const;

const HELPER_CHIPS = [
  "Hi, I'd like to help with this.",
  "When works best for you?",
  "I have everything I need to start.",
] as const;

interface FirstMessageChipsProps {
  viewerRole: "customer" | "helper";
  /** Called with the chip text — caller should insert it into the composer
   *  (NOT auto-send). The parent is also responsible for dismissing the
   *  chip row after a pick. */
  onPick: (text: string) => void;
  className?: string;
}

export function FirstMessageChips({ viewerRole, onPick, className }: FirstMessageChipsProps) {
  const chips = viewerRole === "customer" ? CUSTOMER_CHIPS : HELPER_CHIPS;

  const handlePick = (text: string) => {
    // Haptics is wrapped — web-safe — but a defensive try/catch keeps a
    // bad native bridge state from blocking the actual onPick callback.
    try {
      void hapticLight();
    } catch {
      /* ignore */
    }
    onPick(text);
  };

  return (
    <div
      className={cn("flex flex-wrap gap-2 pt-2", className)}
      role="group"
      aria-label="Suggested first messages"
    >
      {chips.map((text) => (
        <button
          key={text}
          type="button"
          onClick={() => handlePick(text)}
          className={cn(
            "inline-flex items-center min-h-[44px] rounded-ds-md px-3.5 py-2 text-sm transition-colors",
            // State variants only. Hover/focus have no inline-style
            // equivalent, so they stay as Tailwind arbitrary-value classes
            // — the same split MessageActionSheet's ActionRow uses (resting
            // colors inline, `focus-visible:ring-[...]` as a class).
            //
            // The resting background has to stay a class too, precisely
            // BECAUSE of the hover: an inline `background` outranks any
            // non-!important class rule, so moving it into `style` would
            // silently kill `hover:bg-[hsl(var(--ivory-sand))]`.
            "bg-[hsl(var(--parchment))] hover:bg-[hsl(var(--ivory-sand))]",
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--bark))]",
          )}
          style={{
            color: "hsl(var(--ink-deep))",
            border: "1px solid hsl(var(--olivewood))",
          }}
        >
          {text}
        </button>
      ))}
    </div>
  );
}
