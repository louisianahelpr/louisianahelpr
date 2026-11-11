import { isHelprCancelCopy } from "./helprCancelCopy";

export type QuickAction = { label: string; href: string };

type Row = { type: string; title: string; message: string };

/**
 * The bell row's inline quick-action pill, if it earns one. Only actionable types get one, so chat, review and
 * payment rows stay clean.
 *
 * F486 (audit 11-10): Repost is for the person who POSTED. Before this the pill was "Repost" on every
 * `warning` row whose title held "cancelled", which handed a poster-only action to Helprs, sellers and buyers:
 * the Helpr's "Job cancelled" from a Declutter seller-fault cancel (declutter_notify to helper_id, newest
 * 20261109211412), a seller's "Order cancelled" / "Preorder cancelled", a buyer's "Custom order cancelled".
 * Now Repost is offered only on the rows that only ever reach the poster: an expired listing, "Your Helpr
 * cancelled", and an auto-cancel. Every other cancel row gets "View" when it knows where to go.
 *
 * MATCHES STORED TEXT written by Postgres (helprCancelCopy.ts says which).
 */
export function quickActionFor<T extends Row>(n: T, destinationOf: (n: T) => string | null): QuickAction | null {
  if (n.type === "expired") return { label: "Repost", href: "/post-job" };
  const cancelled = n.title.toLowerCase().includes("cancelled") || n.message.toLowerCase().includes("cancelled");
  if (!cancelled && !n.message.toLowerCase().includes("auto-cancel")) return null;
  if (isHelprCancelCopy(n)) {
    // The Helpr's copy of a poster cancellation (poster_cancel_job + notify_on_job_update both emit it). The
    // recipient does not own the job, so send them to the job instead.
    const to = destinationOf(n);
    return to ? { label: "View", href: to } : null;
  }
  if (n.title === "Your Helpr cancelled" || n.message.toLowerCase().includes("auto-cancel")) {
    return { label: "Repost", href: "/post-job" };
  }
  if (n.type === "warning" || n.type === "job_update") {
    const to = destinationOf(n);
    return to ? { label: "View", href: to } : null;
  }
  return null;
}
