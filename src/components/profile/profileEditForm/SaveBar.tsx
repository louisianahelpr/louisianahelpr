import { Loader2, Check } from "lucide-react";

interface SaveBarProps {
  dirty: boolean;
  saving: boolean;
  justSaved: boolean;
  onBack: () => void;
  onSave: (e: React.FormEvent) => void;
}

/**
 * Sticky save bar — keeps the primary action one-tap-away whether the user is
 * at the top of the form or scrolled to the ID upload section at the bottom.
 * Flush full-width bar pinned to the screen edge (mirrors MobileNav's own
 * `fixed bottom-0` dock) rather than a rounded card floating with a gap
 * around it. Frosted glass surface so content behind softly blurs through.
 */
export function SaveBar({ dirty, saving, justSaved, onBack, onSave }: SaveBarProps) {
  return (
    <div
      className="fixed bottom-0 left-0 right-0 z-40 px-4 pt-3 pb-3 flex items-center gap-2"
      style={{
        // `var(--safe-area-bottom)`, never a bare `env(safe-area-inset-bottom)`.
        // This bar is `position: fixed` inside <PageTransition>, whose motion.div
        // carries `will-change: transform` permanently — and WebKit resolves
        // env() to 0 for a fixed descendant of a transformed/promoted ancestor.
        // The inset silently vanished and the bar sat flush on the home
        // indicator. The var is resolved once at :root (no transform above it),
        // which is the whole reason it exists — see the note in index.css.
        paddingBottom: "calc(var(--safe-area-bottom, 0px) + 0.75rem)",
        background: "hsl(var(--surface-band) / 0.92)",
        backdropFilter: "blur(24px) saturate(170%)",
        WebkitBackdropFilter: "blur(24px) saturate(170%)",
        borderTop: "1px solid hsla(0, 0%, 100%, 0.6)",
        boxShadow:
          "inset 0 1px 1px 0 rgba(255, 255, 255, 0.4), " +
          "0 -8px 22px -10px hsl(var(--olivewood) / 0.18)",
      }}
    >
      <button
        type="button"
        onClick={onBack}
        className="flex-1 h-11 rounded-ds-md inline-flex items-center justify-center text-ds-13 font-semibold text-foreground hover:bg-secondary/40 active:scale-[0.98] transition-all"
      >
        Cancel
      </button>
      {(() => {
        // Save is muted + disabled when nothing's changed, so the
        // bar reflects state instead of always inviting a tap.
        const idle = !dirty && !saving && !justSaved;
        return (
          <button
            type="button"
            onClick={(e) => onSave(e as unknown as React.FormEvent)}
            disabled={saving || justSaved || !dirty}
            className="flex-[2] h-11 rounded-ds-md inline-flex items-center justify-center gap-2 text-ds-13 font-bold transition-all active:scale-[0.98] disabled:active:scale-100"
            style={{
              background: saving || idle ? "hsl(var(--muted))" : "hsl(var(--bark))",
              color: saving || idle ? "hsl(var(--muted-foreground))" : "hsl(var(--parchment))",
              border: "1px solid hsl(var(--bark-border))",
              boxShadow: idle
                ? "none"
                : "inset 0 1px 0 0 rgba(255, 255, 255, 0.12), " +
                  "0 1px 2px hsl(var(--bark-border) / 0.18), " +
                  "0 6px 14px -4px hsl(var(--bark) / 0.4)",
              cursor: saving || idle ? "not-allowed" : "pointer",
            }}
          >
            {saving ? (<><Loader2 className="w-4 h-4 animate-spin" /> Saving…</>) : justSaved ? (<><Check className="w-4 h-4" strokeWidth={3} /> Saved</>) : idle ? "Up to Date" : "Save Changes"}
          </button>
        );
      })()}
    </div>
  );
}
