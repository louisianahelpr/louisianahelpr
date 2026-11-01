/**
 * B56 speed (10-31): the build's "sonner" is src/lib/sonnerFacade.ts, so Sonner's Toaster UI (one 14.7 KB gz module
 * with `toast`) leaves the boot path: boot 266 -> 258 KB gz, every first-load route -8 KB gz (critical-path.mjs).
 * The class: a toast made before Sonner arrives is lost, reordered, or cannot be dismissed by the id it returned;
 * or the build stops aliasing it (Sonner back on boot).
 *
 * @mutate src/lib/sonnerFacade.ts |       for (const run of queue.splice(0)) run(real); |       queue.splice(0);
 * @mutate src/lib/sonnerFacade.ts |   const id = (data?.id as string \| number \| undefined) ?? `t${++seq}`; |   const id = `t${++seq}`;
 * @mutate vite.config.ts |       ...(command === "build" ? [{ find: /^sonner$/, | ...(false ? [{ find: /^sonner$/,
 */
import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const calls: unknown[][] = [];
vi.mock("sonner-real", () => {
  const rec = (name: string) => (m: unknown, d?: { id?: unknown }) => {
    calls.push([name, m, d]);
    return d?.id;
  };
  const toast = Object.assign(rec("toast"), {
    success: rec("success"), error: rec("error"), warning: rec("warning"), info: rec("info"), message: rec("message"),
    loading: rec("loading"), custom: rec("custom"),
    dismiss: (id?: unknown) => { calls.push(["dismiss", id]); return id; },
    promise: (p: unknown) => { calls.push(["promise", p]); return undefined; },
    getToasts: () => [], getHistory: () => [],
  });
  return { toast };
});

describe("the boot-path toast queues until Sonner arrives", () => {
  it("replays every early call in order, each with the id it returned, and dismisses by that id", async () => {
    const { toast } = await import("./sonnerFacade");
    const a = toast.error("Card declined");
    const b = toast("Saved", { id: "mine" });
    toast.dismiss(a);
    expect(typeof a === "string" && a.length > 0).toBe(true);
    expect(b).toBe("mine");
    await vi.waitFor(() => expect(calls.length).toBe(3));
    expect(calls).toEqual([
      ["error", "Card declined", { id: a }],
      ["toast", "Saved", { id: "mine" }],
      ["dismiss", a],
    ]);
    // Once loaded, calls go straight through.
    const c = toast.warning("Offline");
    expect(calls[calls.length - 1]).toEqual(["warning", "Offline", { id: c }]);
    expect(calls.length).toBeGreaterThan(3);
  });

  it("the production build aliases sonner to it, and the Toaster imports the real package", () => {
    const cfg = readFileSync(resolve("vite.config.ts"), "utf8");
    expect(cfg).toContain('...(command === "build" ? [{ find: /^sonner$/, replacement: path.resolve(import.meta.dirname, "./src/lib/sonnerFacade.ts") }] : []),');
    expect(cfg).toContain('{ find: /^sonner-real$/, replacement: path.resolve(import.meta.dirname, "./node_modules/sonner/dist/index.mjs") },');
    expect(readFileSync(resolve("src/components/ui/sonner.tsx"), "utf8")).toContain('import { Toaster as Sonner, toast } from "sonner-real";');
  });
});
