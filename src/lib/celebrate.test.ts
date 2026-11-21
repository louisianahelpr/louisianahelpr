/**
 * The celebration confetti: it fires only the first few times per event (the count is kept on the device), its
 * canvas is hidden from assistive tech and removed when the burst ends (Q212), and a failure never breaks the flow.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const fired: Array<{ canvas: HTMLCanvasElement; options: Record<string, unknown> }> = [];
let burst: () => Promise<unknown> = () => Promise.resolve();
let moduleMissing = false;

vi.mock("canvas-confetti", () => ({
  default: {
    create: (canvas: HTMLCanvasElement) => (options: Record<string, unknown>) => {
      fired.push({ canvas, options });
      return burst();
    },
  },
}));
vi.mock("@/lib/loadModule", () => ({
  loadModule: async (load: () => Promise<unknown>) => (moduleMissing ? null : load()),
}));

import { fireConfetti, getBrandColors, maybeCelebrate } from "./celebrate";
import { safeStorage } from "@/lib/safeStorage";

const canvases = () => document.body.querySelectorAll("canvas").length;

beforeEach(() => {
  fired.length = 0;
  burst = () => Promise.resolve();
  moduleMissing = false;
  safeStorage.removeItem("helpr_post_count");
  safeStorage.removeItem("helpr_review_count");
  document.documentElement.style.removeProperty("--bark");
});
afterEach(() => {
  document.body.querySelectorAll("canvas").forEach((c) => c.remove());
});

describe("getBrandColors", () => {
  it("falls back to the fixed brand colors when the theme sets none", () => {
    expect(getBrandColors()).toEqual(["#5E6544", "#8C947D", "#A0613B", "#D4A55F", "#FAF8F5"]);
  });
  it("uses the theme's own color when it is set", () => {
    document.documentElement.style.setProperty("--bark", "72 20% 33%");
    expect(getBrandColors()[0]).toBe("hsl(72 20% 33%)");
  });
});

describe("fireConfetti", () => {
  it("draws on a canvas hidden from assistive tech and removes it when the burst ends", async () => {
    let end: () => void = () => undefined;
    burst = () => new Promise<void>((resolve) => { end = resolve; });
    await fireConfetti({ particleCount: 5 });
    expect(fired).toHaveLength(1);
    expect(fired[0].options).toEqual({ particleCount: 5 });
    expect(fired[0].canvas.getAttribute("aria-hidden")).toBe("true");
    expect(fired[0].canvas.style.pointerEvents).toBe("none");
    expect(canvases()).toBe(1);
    end();
    await vi.waitFor(() => expect(canvases()).toBe(0));
  });
  it("removes the canvas when the burst fails", async () => {
    burst = () => Promise.reject(new Error("no canvas context"));
    await fireConfetti({});
    await vi.waitFor(() => expect(canvases()).toBe(0));
  });
  it("removes the canvas when the library returns nothing (reduced motion)", async () => {
    burst = () => null as unknown as Promise<unknown>;
    await fireConfetti({});
    expect(canvases()).toBe(0);
  });
  it("fires nothing when the confetti module did not load", async () => {
    moduleMissing = true;
    await fireConfetti({});
    expect(fired).toHaveLength(0);
    expect(canvases()).toBe(0);
  });
});

describe("maybeCelebrate", () => {
  it("fires the first three times for an event, then goes quiet", async () => {
    for (let i = 0; i < 5; i++) await maybeCelebrate("first_post");
    expect(fired).toHaveLength(3);
    expect(safeStorage.getItem("helpr_post_count")).toBe("3");
    expect(fired[0].options).toMatchObject({ particleCount: 80, spread: 70, origin: { y: 0.4 } });
  });
  it("counts each event on its own and honors the caller's limit and size", async () => {
    await maybeCelebrate("first_post");
    await maybeCelebrate("first_review", { limit: 1, particleCount: 120, originY: 0.6 });
    await maybeCelebrate("first_review", { limit: 1 });
    expect(fired).toHaveLength(2);
    expect(fired[1].options).toMatchObject({ particleCount: 120, origin: { y: 0.6 } });
    expect(safeStorage.getItem("helpr_review_count")).toBe("1");
  });
  it("a count that is not a number starts again from zero", async () => {
    safeStorage.setItem("helpr_post_count", "garbage");
    await maybeCelebrate("first_post");
    expect(safeStorage.getItem("helpr_post_count")).toBe("1");
  });
  it("never throws, and does not count a burst that did not fire", async () => {
    burst = () => { throw new Error("canvas refused"); };
    await expect(maybeCelebrate("first_post")).resolves.toBeUndefined();
    expect(safeStorage.getItem("helpr_post_count")).toBeNull();
    expect(canvases()).toBe(0);
  });
});
