/**
 * Imperative trigger for the global SuccessMoment overlay.
 *
 * Mutation handlers (accept applicant, complete job, …) sit far from the
 * React tree that renders the celebration, so instead of prop-drilling a
 * setter we use a tiny module-level subscriber: `<SuccessMomentHost />`
 * (mounted once in App.tsx) subscribes, and any handler calls
 * `fireSuccessMoment()`.
 *
 * The moment is pure delight — it must NEVER block or throw into a flow,
 * so subscriber notification is wrapped in a try/catch.
 */
export interface SuccessMomentRequest {
  /** Screen-reader label, e.g. "Applicant hired". */
  label: string;
}

type Listener = (req: SuccessMomentRequest) => void;

let listener: Listener | null = null;

/** Internal — wired up by <SuccessMomentHost />. */
export function subscribeSuccessMoment(fn: Listener): () => void {
  listener = fn;
  return () => {
    if (listener === fn) listener = null;
  };
}

/**
 * Play a brief, non-blocking success overlay. Safe to call from anywhere;
 * a no-op if the host isn't mounted yet.
 */
export function fireSuccessMoment(req: SuccessMomentRequest): void {
  try {
    listener?.(req);
  } catch {
    /* delight is candy — never break the flow */
  }
}
