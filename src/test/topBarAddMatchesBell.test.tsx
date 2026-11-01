/**
 * THE SECTION'S OWN "+" IN ITS TOP BAR, DESKTOP WEBSITE ONLY, IN THE LIGHTER GREEN (owner 2026-10-28, desktop
 * /jobs: "i actually think we should add the post a job and post an item or whatever buttons back on the top nav
 * maybe just make it the lighter green"; the same morning it had been removed: "do we need the post a job since the
 * create is to post etc?").
 *
 * The class, from the app's own inventory (SECTIONS): on the desktop website every section's bar carries ONE soft
 * button beside the bell, "+ <cta or label>", named by the full label, going to the section's add path, a soft olive
 * tint with no shadow and no filled primary (clearly second to the rail's solid "+ Create"); "Post a job" keeps the
 * under-18 post gate. A phone bar carries none (the bottom bar's center "+" creates), and the bell keeps its 44px
 * size. Before 2026-10-19 the phone "+" was a filled olive circle; this file was topBarAddMatchesBell.test.ts.
 *
 * @mutate src/components/sections/AppTopBar.tsx | <div className="flex items-center gap-1 min-[360px]:gap-0 shrink-0">{personal}</div> | <div className="flex items-center gap-1 min-[360px]:gap-0 shrink-0">{section && <button type="button" data-testid="section-add" />}{personal}</div>
 * @mutate src/components/sections/AppTopBar.tsx |       {add.cta ?? add.label} |       {add.label}
 * @mutate src/components/sections/AppTopBar.tsx |       variant="ghost"\n      size="sm"\n      aria-label={add.label} |       variant="primary"\n      size="sm"\n      aria-label={add.label}
 * @mutate src/components/sections/AppTopBar.tsx |       onClick={isPost ? gate.gate("post", go) : go} |       onClick={go}
 * @mutate src/components/sections/AppTopBar.tsx |       actions={actions} |
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { blankComments } from "./helpers/blankNonCode";

const env = vi.hoisted(() => ({ desktop: true, under18: false }));
vi.mock("@/hooks/useIsWebDesktop", () => ({ useIsWebDesktop: () => env.desktop }));
vi.mock("@/components/NotificationPanel", () => ({ default: ({ triggerClassName }: { triggerClassName?: string }) => <button type="button" aria-label="Notifications" className={triggerClassName} /> }));
// The title bars draw NotificationBell, which swaps the panel in: the same stand-in.
vi.mock("@/components/notificationPanel/NotificationBell", () => ({ default: ({ triggerClassName }: { triggerClassName?: string }) => <button type="button" aria-label="Notifications" className={triggerClassName} /> }));
vi.mock("@/hooks/useCurrentUser", () => ({ useCurrentUser: () => ({ user: { id: "u-1" }, profile: { avatar_url: null, full_name: "Test Person" } }) }));
vi.mock("@/hooks/useAgeGate", () => ({
  useAgeGate: () => ({
    underAge: env.under18,
    explain: () => {},
    gate: (_kind: string, fn: () => void) => () => { if (!env.under18) fn(); },
    gatedProps: () => (env.under18 ? { "aria-disabled": true, "data-age-gated": "" } : {}),
  }),
}));

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { AppTopBar } from "@/components/sections/AppTopBar";
import { SECTIONS } from "@/components/sections/sectionsConfig";
import { registerDesktopTitleSlot } from "@/components/header/PageTitleBar";

// The desktop app header's title slot (DesktopTopNav registers it): the section bar portals its row there.
const slot = document.createElement("div");
document.body.appendChild(slot);
registerDesktopTitleSlot(slot);

afterEach(() => {
  cleanup();
  env.desktop = true;
  env.under18 = false;
});

function Where() {
  const l = useLocation();
  return <p data-testid="where">{l.pathname + l.search}</p>;
}
const draw = (section: (typeof SECTIONS)[number]) =>
  render(
    <QueryClientProvider client={new QueryClient()}>
      <MemoryRouter initialEntries={["/start"]}>
        <Routes>
          <Route path="*" element={<><AppTopBar title={section.label} explore section={section.key} /><Where /></>} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );

describe("the section's soft '+' in its top bar, desktop website only (owner 2026-10-28)", () => {
  it("every section: one soft button, '+ <cta or label>', named by the full label, going to its add path", () => {
    expect(SECTIONS.length).toBeGreaterThan(3);
    const seen: string[] = [];
    for (const s of SECTIONS) {
      draw(s);
      const add = screen.getByTestId("section-add");
      expect(add.getAttribute("aria-label")).toBe(s.add.label);
      expect(add.textContent).toBe(s.add.cta ?? s.add.label);
      // Lighter green: a soft olive tint, olive text, no shadow, never the solid primary surface.
      expect(add.className).toContain("bg-[hsl(var(--bark)/0.12)]");
      expect(add.className).toContain("text-[hsl(var(--bark))]");
      expect(add.className).toContain("shadow-none");
      expect(add.className).not.toMatch(/btn-grad-primary/);
      fireEvent.click(add);
      expect(screen.getByTestId("where").textContent).toBe(s.add.path);
      seen.push(add.textContent ?? "");
      cleanup();
    }
    expect(seen).toEqual(["Post a job", "Sell an item", "Open a shop", "Add a property"]);
  });

  it("Post a job keeps the under-18 post gate", () => {
    env.under18 = true;
    draw(SECTIONS.find((s) => s.key === "jobs")!);
    const add = screen.getByTestId("section-add");
    expect(add.getAttribute("aria-disabled")).toBe("true");
    fireEvent.click(add);
    expect(screen.getByTestId("where").textContent).toBe("/start");
  });

  it("a phone bar carries no '+' (the bottom bar's center '+' creates)", () => {
    env.desktop = false;
    for (const s of SECTIONS) {
      draw(s);
      expect(screen.queryByTestId("section-add")).toBeNull();
      cleanup();
    }
  });

  it("the bell keeps its 44px size and 22px glyph", () => {
    const bar = blankComments(readFileSync(resolve(__dirname, "../components/sections/AppTopBar.tsx"), "utf8"));
    const bell = bar.match(/<NotificationPanel triggerClassName="([^"]+)"/)?.[1] ?? "";
    expect(bell.startsWith("h-11 w-11 [&>svg]:w-[22px] [&>svg]:h-[22px]"), `bell "${bell}"`).toBe(true);
  });
});
