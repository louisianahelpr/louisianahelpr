import { useRef, type ReactNode } from "react";

/**
 * RadioCardList: the ONE "pick one reason" list (spec v2 §1.3 "one of each";
 * boards 54 and 157). Full-width white cards, a radio circle on the left, the
 * label in semibold, an optional second line. The picked card gets an olive
 * ring and an olive dot (olive = action, spec v2 §1.1). Nothing else moves, so
 * a long label can wrap to two lines without shifting its neighbours.
 *
 * A real radio group for assistive tech: role="radiogroup" with role="radio"
 * rows and aria-checked; arrow keys move and pick, like a native group.
 */
export interface RadioCardOption {
  value: string;
  label: ReactNode;
  sub?: ReactNode;
}

export function RadioCardList({
  label,
  required,
  options,
  value,
  onChange,
}: {
  /** The group's accessible name (the question the list answers). */
  label: string;
  /** A pick is needed before the form can be sent. */
  required?: boolean;
  options: readonly RadioCardOption[];
  value: string;
  /** `via` says how: a tap ("click") or an arrow key ("key"). Callers fire
   *  haptics on a tap only, never on every arrow step. */
  onChange: (value: string, via: "click" | "key") => void;
}) {
  const listRef = useRef<HTMLDivElement>(null);
  const move = (from: number, step: number) => {
    const at = (from + step + options.length) % options.length;
    onChange(options[at].value, "key");
    // Focus follows the pick, as in a native radio group. By index inside
    // THIS list: no document-wide selector, so no escaping and no collision
    // with another list on the page that shares a value.
    requestAnimationFrame(() => {
      listRef.current?.querySelectorAll<HTMLElement>('[role="radio"]')[at]?.focus();
    });
  };
  const focusable = value && options.some((o) => o.value === value) ? value : options[0]?.value;

  return (
    <div ref={listRef} role="radiogroup" aria-label={label} aria-required={required || undefined} className="space-y-2">
      {options.map((o, i) => {
        const on = o.value === value;
        return (
          <button
            key={o.value}
            type="button"
            role="radio"
            aria-checked={on}
            tabIndex={o.value === focusable ? 0 : -1}
            onClick={() => onChange(o.value, "click")}
            onKeyDown={(e) => {
              if (e.key === "ArrowDown" || e.key === "ArrowRight") { e.preventDefault(); move(i, 1); }
              if (e.key === "ArrowUp" || e.key === "ArrowLeft") { e.preventDefault(); move(i, -1); }
              if (e.key === "Home") { e.preventDefault(); move(0, 0); }
              if (e.key === "End") { e.preventDefault(); move(options.length - 1, 0); }
            }}
            className="w-full flex items-center gap-3 min-h-[52px] px-4 py-3 rounded-2xl text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
            // Inline, not `bg-card`: the T2 card rule makes every .bg-card
            // border transparent (!important), which would hide the olive ring.
            style={{
              background: "hsl(var(--card))",
              border: on ? "1.5px solid hsl(var(--bark))" : "1px solid hsl(var(--border))",
              // Keep the label still when the border thickens.
              padding: on ? "calc(0.75rem - 0.5px) calc(1rem - 0.5px)" : undefined,
            }}
          >
            <span
              aria-hidden
              className="shrink-0 w-5 h-5 rounded-full flex items-center justify-center"
              style={{ border: `1.5px solid ${on ? "hsl(var(--bark))" : "hsl(var(--muted-foreground))"}` }}
            >
              {on && <span className="w-2.5 h-2.5 rounded-full" style={{ background: "hsl(var(--bark))" }} />}
            </span>
            <span className="flex-1 min-w-0 whitespace-normal break-words">
              <span className="block font-sans font-semibold text-ds-14 leading-snug" style={{ color: "hsl(var(--ink-deep))" }}>
                {o.label}
              </span>
              {o.sub && <span className="block font-sans text-ds-12 leading-snug text-muted-foreground mt-0.5">{o.sub}</span>}
            </span>
          </button>
        );
      })}
    </div>
  );
}
