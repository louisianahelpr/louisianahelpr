import type { ReactNode } from "react";

/**
 * FieldError — the inline validation message beneath a form field.
 *
 * `Label` and `Input` were already tokenised primitives; the error state was
 * the one part of the form trio that never got one. It existed instead as an
 * identical hand-written literal in two files
 * (`<p className="text-ds-11 font-sans font-semibold leading-snug" style={{ color: "hsl(var(--destructive))" }}>`),
 * which meant every new form added a third copy.
 *
 * The reason to extract it is not tidiness — it is that the literal was
 * missing `role="alert"`, so a screen-reader user got NO announcement when
 * validation failed. Centralising it fixes that everywhere at once and makes
 * it the default for every form built after this.
 *
 * Renders nothing when there is no message, so callers can pass a possibly
 * empty error straight through without a ternary.
 */
export function FieldError({
  children,
  id,
}: {
  children?: ReactNode;
  /** Wire to the input's `aria-describedby` so the error is programmatically
   *  associated with the field, not just visually adjacent to it. */
  id?: string;
}) {
  if (!children) return null;
  return (
    <p
      id={id}
      // role="alert" (implicit aria-live="assertive") is the whole point:
      // validation failures must be announced, not merely displayed.
      role="alert"
      className="text-ds-11 font-sans font-semibold leading-snug"
      style={{ color: "hsl(var(--destructive))" }}
    >
      {children}
    </p>
  );
}
