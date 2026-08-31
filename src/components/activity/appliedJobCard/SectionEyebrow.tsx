import type { CSSProperties, ReactNode } from "react";

/**
 * THE section label on the helper's job cards — one style, one place.
 *
 * Owner, 2026-08-30: "eye brows were removed so update so they know what things
 * are." The expanded application card stacked four blocks and labelled exactly
 * one of them ("Your attachments"), so the poster's job description and the
 * helper's own application message sat adjacent, both unlabelled, with nothing
 * saying which was whose.
 *
 * The surviving "Your attachments" eyebrow IS the treatment — this is that
 * declaration lifted verbatim (`font-serif italic uppercase text-ds-10`,
 * burnt-sienna, 0.18em tracking) rather than a second label style invented
 * beside it. Every call site renders through this so they cannot drift again.
 *
 * Two things it deliberately gets right:
 *  - **The capitals come from CSS, never from the source string.** Typing
 *    "YOUR ATTACHMENTS" makes some screen readers spell it out letter by
 *    letter; `text-transform: uppercase` on Title Case does not.
 *  - **It is a real heading (or a real <label>), not decoration.** Pass `as`
 *    and `htmlFor` when the block it names is a form control, so the eyebrow IS
 *    that control's label; otherwise it renders an <h4> that the labelled
 *    section points at with `aria-labelledby`.
 */
export const EYEBROW_CLASS = "font-serif italic uppercase text-ds-10";
export const EYEBROW_STYLE: CSSProperties = {
  color: "hsl(var(--burnt-sienna))",
  letterSpacing: "0.18em",
};

export function SectionEyebrow({
  children,
  id,
  htmlFor,
  className,
}: {
  children: ReactNode;
  id?: string;
  /** When present the eyebrow renders as the <label> for that control. */
  htmlFor?: string;
  className?: string;
}) {
  const cls = className ? `${EYEBROW_CLASS} ${className}` : EYEBROW_CLASS;
  if (htmlFor) {
    return (
      <label htmlFor={htmlFor} id={id} className={cls} style={EYEBROW_STYLE}>
        {children}
      </label>
    );
  }
  return (
    <h4 id={id} className={cls} style={EYEBROW_STYLE}>
      {children}
    </h4>
  );
}
