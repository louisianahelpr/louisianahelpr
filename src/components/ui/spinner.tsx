/**
 * Spinner — the shared inline "working…" ring (owner, 2026-10-29: "nothing
 * should be hand made"). It replaces the hand-written
 * `<Loader2 className="h-4 w-4 animate-spin" />` repeated across the app.
 *
 * Full-page and "wait a beat" loaders keep the branded HelprSpinner; this one
 * is the small ring inside a button, a row or a field.
 *
 * Accessibility: with no `label` it is decorative and hidden from assistive
 * tech (what lucide does for a bare icon), because the button or row around it
 * already says what is happening. Give it a `label` when it stands alone: it
 * then becomes a polite `role="status"` with that name.
 *
 * Guard: src/test/noHandBuiltUi.test.ts counts raw `animate-spin` outside
 * src/components/ui/ and the count can only shrink.
 */
import { Loader2, type LucideProps } from "lucide-react";
import { cn } from "@/lib/utils";

export interface SpinnerProps extends Omit<LucideProps, "ref"> {
  /** Spoken name when the spinner stands alone; omit it inside a labelled control. */
  label?: string;
}

export function Spinner({ label, className, ...props }: SpinnerProps) {
  const a11y = label ? { role: "status" as const, "aria-label": label } : { "aria-hidden": true as const };
  return <Loader2 {...a11y} {...props} className={cn("animate-spin", className)} />;
}
