/**
 * Flow audit 11-23 (C2, re-confirmed on live www 11-24): on an iPhone (also iPad and desktop), Declutter item -> tap the
 * big photo (full screen) -> Back / swipe-back landed on the /declutter grid and the item was gone. The full-screen
 * photo viewer pushed no history entry, so Back left the page. Same class as the guide sheets (B4, PR #4938): every
 * full-screen overlay the Declutter item page can open now registers the shared useCloseOnBack hook, so Back closes
 * only the overlay and a second Back leaves the item.
 *
 * Inventory from source (not a hand list): every file reachable from DeclutterItemView through imports that stay
 * inside src/components/declutter/, plus each non-primitive component file those import that itself draws an overlay
 * (the shared photo viewer, the Report dialog...). A file "draws an overlay" when it imports the Sheet / Dialog /
 * AlertDialog / Drawer primitives, portals with createPortal, or paints a `fixed inset-0` layer. Each must call
 * useCloseOnBack, or sit in BACK_ALREADY_CLOSES with the reason (exact both ways).
 *
 * @mutate src/components/dashboard/PhotoLightbox.tsx |   useCloseOnBack(lightboxIndex !== null && photos.length > 0, () => setLightboxIndex(null)); |   void useCloseOnBack;
 * @mutate src/components/declutter/DeclutterConfirmSheet.tsx |   useCloseOnBack(open, () => onOpenChange(false)); |   void useCloseOnBack;
 * @mutate src/components/declutter/DeclutterOfferTrade.tsx |   useCloseOnBack(open, () => onOpenChange(false)); |   void useCloseOnBack;
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { existsSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { useState } from "react";
import { act, cleanup, fireEvent, render, screen, waitFor, waitForElementToBeRemoved } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { blankComments } from "./helpers/blankNonCode";

vi.mock("@/lib/analytics", () => ({ track: vi.fn() }));

import { DeclutterGallery } from "@/components/declutter/DeclutterGallery";
import { ConfirmSheet } from "@/components/declutter/DeclutterConfirmSheet";

const ROOT = resolve(__dirname, "../..");
const ENTRY = "src/components/declutter/DeclutterItemView.tsx";
const OVERLAY = /["']@\/components\/ui\/(sheet|dialog|alert-dialog|drawer)["']|\bcreatePortal\b|\bfixed inset-0\b/;

/** Graph members that need no hook: Back already works another way (registering it too would need two Backs), or the
 * item page never opens them. Each says why. */
const BACK_ALREADY_CLOSES: Record<string, string> = {
  // The handover chat opens by pushing ?talk=<id> onto the address (useOpenTalk -> setSearchParams), so Back pops
  // that entry and HandoverTalkFromLink unmounts the sheet.
  "src/components/declutter/DeclutterHandoverTalk.tsx": "opens through ?talk= in the address; Back already closes it",
  // Not opened from the item page: the graph reaches it only because DeclutterMilesFrom takes the offerAsk helper from
  // DeclutterBrowseBar, which also draws the Browse filter sheet. The item page never renders that sheet.
  "src/components/dashboard/FilterSheet.tsx": "Browse's filter sheet, reached through a helper import only",
};

function resolveImport(from: string, spec: string): string | null {
  const base = spec.startsWith("@/") ? join(ROOT, "src", spec.slice(2)) : spec.startsWith(".") ? resolve(dirname(from), spec) : null;
  if (!base) return null;
  for (const ext of ["", ".tsx", ".ts", "/index.tsx", "/index.ts"]) {
    const p = base + ext;
    if (existsSync(p) && statSync(p).isFile()) return p;
  }
  return null;
}

/** The item page's overlay files, from its import graph (see header). */
export function itemPageOverlays(): string[] {
  const seen = new Set<string>();
  const outside = new Set<string>();
  const queue = [join(ROOT, ENTRY)];
  while (queue.length) {
    const file = queue.pop()!;
    if (seen.has(file)) continue;
    seen.add(file);
    const src = blankComments(readFileSync(file, "utf8"));
    // `import type` brings no component in, so it opens nothing.
    for (const m of src.matchAll(/^(?!\s*import\s+type\b).*?(?:\bfrom\s+|\bimport\(\s*)["']([^"']+)["']/gm)) {
      const r = resolveImport(file, m[1]);
      if (!r) continue;
      if (r.includes("/src/components/declutter/")) queue.push(r);
      else if (r.includes("/src/components/") && !r.includes("/src/components/ui/")) outside.add(r);
    }
  }
  const draws = (f: string) => OVERLAY.test(blankComments(readFileSync(f, "utf8")));
  return [...new Set([...seen, ...outside])].filter((f) => !f.endsWith(".test.ts") && !f.endsWith(".test.tsx") && draws(f)).map((f) => relative(ROOT, f)).sort();
}

const registers = (rel: string) => /\buseCloseOnBack\s*\(/.test(blankComments(readFileSync(join(ROOT, rel), "utf8")));

describe("every full-screen overlay on the Declutter item page closes on Back (C2)", () => {
  const overlays = itemPageOverlays();

  it("finds the item page's overlays from its import graph", () => {
    expect(overlays.length).toBeGreaterThan(6);
    expect(overlays).toContain("src/components/dashboard/PhotoLightbox.tsx");
    expect(overlays).toContain("src/components/declutter/DeclutterOfferTrade.tsx");
  });

  it("each one registers useCloseOnBack (or Back already closes it, said why)", () => {
    const missing = overlays.filter((f) => !(f in BACK_ALREADY_CLOSES) && !registers(f));
    expect(missing).toEqual([]);
  });

  it("the exemption list is exact: each entry is still an item-page overlay and still does not register the hook", () => {
    for (const f of Object.keys(BACK_ALREADY_CLOSES)) {
      expect(overlays).toContain(f);
      expect(registers(f)).toBe(false);
    }
  });
});

const back = async () => { await act(async () => { window.history.back(); await new Promise((r) => setTimeout(r, 30)); }); };
const tick = () => act(async () => { await new Promise((r) => setTimeout(r, 30)); });
const marked = () => (window.history.state as Record<string, unknown> | null)?.lhSheet === true;

afterEach(async () => {
  cleanup();
  await tick();
});

describe("Declutter overlays: Back closes the overlay, the page stays (C2)", () => {
  it("full-screen photo: Back closes the viewer, keeps the item; the close button takes the entry back off", async () => {
    render(<MemoryRouter><DeclutterGallery urls={["https://example.com/a.jpg", "https://example.com/b.jpg"]} category="home" title="Lamp" /></MemoryRouter>);
    const startLen = window.history.length;
    fireEvent.click(screen.getByRole("button", { name: "Open photo 1 of 2 full screen" }));
    const viewer = await screen.findByRole("dialog", { name: "Photo viewer" });
    expect(marked()).toBe(true);
    expect(window.history.length).toBe(startLen + 1);
    await back();
    if (viewer.isConnected) await waitForElementToBeRemoved(viewer);
    expect(screen.queryByRole("dialog", { name: "Photo viewer" })).toBeNull();
    // The item page is still there (its photos), and Back did not run past it.
    expect(screen.getByRole("group", { name: "Photos of Lamp" })).toBeTruthy();
    expect(marked()).toBe(false);

    // Open again and close with the X: no stray entry left for the next Back.
    fireEvent.click(screen.getByRole("button", { name: "Open photo 2 of 2 full screen" }));
    const again = await screen.findByRole("dialog", { name: "Photo viewer" });
    expect(marked()).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "Close photo viewer" }));
    if (again.isConnected) await waitForElementToBeRemoved(again);
    await tick();
    expect(marked()).toBe(false);
  });

  it("a sheet (Confirm): Back closes it and keeps the page", async () => {
    function Host() {
      const [open, setOpen] = useState(true);
      return (
        <div data-host="">
          <ConfirmSheet open={open} title="Take it down?" confirmLabel="Yes" onConfirm={() => setOpen(false)} onClose={() => setOpen(false)} testId="t">
            Sure?
          </ConfirmSheet>
        </div>
      );
    }
    render(<MemoryRouter><Host /></MemoryRouter>);
    await waitFor(() => expect(document.querySelector("[data-confirm-sheet]")).not.toBeNull());
    const sheet = document.querySelector("[data-confirm-sheet]") as HTMLElement;
    expect(marked()).toBe(true);
    await back();
    if (sheet.isConnected) await waitForElementToBeRemoved(sheet);
    expect(document.querySelector("[data-confirm-sheet]")).toBeNull();
    expect(document.querySelector("[data-host]")).not.toBeNull();
    expect(marked()).toBe(false);
  });
});
