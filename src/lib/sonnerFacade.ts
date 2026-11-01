/**
 * The `toast` every screen imports, without Sonner on the boot path (B56 speed, 10-31).
 *
 * Sonner ships its Toaster UI and its `toast` function in ONE module (node_modules/sonner/dist/index.mjs, 14.7 KB
 * gz), so a single static `import { toast } from "sonner"` on the boot graph (main.tsx -> toastPolicy.ts) put the
 * whole Toaster on every page's critical path, although DeferredToasters mounts it only after first paint.
 * In the production build, vite.config.ts aliases "sonner" to this file and "sonner-real" to the package. Calls
 * made before Sonner arrives are queued and replayed in order; each gets its id at once (Sonner accepts a caller
 * id), so a later toast.dismiss(id) still finds it. Dev and tests use the real package unchanged.
 */
type RealToast = typeof import("sonner-real").toast;
type Data = Record<string, unknown> | undefined;
const METHODS = ["success", "error", "warning", "info", "message", "loading", "custom"] as const;

let real: RealToast | null = null;
let loading: Promise<void> | null = null;
const queue: Array<(t: RealToast) => void> = [];
let seq = 0;

function load(): void {
  if (loading) return;
  loading = import("sonner-real").then(
    (m) => {
      real = m.toast;
      for (const run of queue.splice(0)) run(real);
    },
    (err: unknown) => {
      // The chunk failed to load (offline, a deploy swapped it): try again on the next toast, never drop silently.
      loading = null;
      console.error("[toast] Sonner failed to load", err);
    },
  );
}

function withId(data: Data): { id: string | number } & Record<string, unknown> {
  const id = (data?.id as string | number | undefined) ?? `t${++seq}`;
  return { ...(data ?? {}), id };
}

function send(method: (typeof METHODS)[number] | null, message: unknown, data: Data): string | number {
  const d = withId(data);
  const run = (t: RealToast) =>
    method ? (t[method] as (m: unknown, d: unknown) => unknown)(message, d) : (t as (m: unknown, d: unknown) => unknown)(message, d);
  if (real) run(real);
  else {
    queue.push(run);
    load();
  }
  return d.id;
}

const facade = ((message: unknown, data?: Data) => send(null, message, data)) as unknown as RealToast;
for (const m of METHODS) {
  (facade as unknown as Record<string, unknown>)[m] = (message: unknown, data?: Data) => send(m, message, data);
}
(facade as unknown as Record<string, unknown>).dismiss = (id?: string | number) => {
  if (real) return real.dismiss(id);
  queue.push((t) => t.dismiss(id));
  load();
  return id;
};
(facade as unknown as Record<string, unknown>).promise = (p: unknown, data?: unknown) => {
  if (real) return real.promise(p as never, data as never);
  queue.push((t) => t.promise(p as never, data as never));
  load();
  return undefined;
};
(facade as unknown as Record<string, unknown>).getToasts = () => (real ? real.getToasts() : []);
(facade as unknown as Record<string, unknown>).getHistory = () => (real ? real.getHistory() : []);

export const toast: RealToast = facade;
