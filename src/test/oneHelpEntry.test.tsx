/**
 * UX-6 (owner approved 2026-10-29): one Help entry on every signed-in screen. It opens Get help now with the shared
 * "within a few hours" promise and goes to the same /support form as the job page's GetHelpNow. Renders the REAL
 * HelpEntry and follows its navigation; pins the shared mounts.
 *
 * Nav redesign (owner, 2026-11-06 ~11:35 AM: "Help moves into the You menu"): the phone top bar no longer carries
 * the Help button; You (the top bar's photo) > "Talk to a real person" (captioned Help) opens the Help screen in ONE
 * tap. The desktop top nav and the sub-screen PageHeader keep their Help entry.
 *
 * @mutate src/components/help/HelpEntry.tsx | const SUPPORT_PATH = "/support?topic=message"; | const SUPPORT_PATH = "/support";
 * @mutate src/components/help/HelpEntryPanel.tsx | <p className="text-ds-13 text-muted-foreground">{SUPPORT_REPLY_PROMISE}</p> | <p className="text-ds-13 text-muted-foreground">We'll get back to you.</p>
 * @mutate src/components/DesktopTopNav.tsx | <HelpEntry /> | {null}
 * @mutate src/components/profile/profileLanding/YouMenu.tsx |   { key: "support", label: "Talk to a real person" },\n |
 * @mutate src/components/profile/profileLanding/YouMenu.tsx | onSelect={(key) => (key === ADMIN_ROW.key ? navigate("/admin") : onSelectTab(key))} | onSelect={(key) => (key === ADMIN_ROW.key ? navigate("/admin") : key === "support" ? undefined : onSelectTab(key))}
 * @mutate src/components/profile/profileLanding/YouMenu.tsx |   support: "Help",\n}; |   support: "",\n};
 * @mutate src/components/PageHeader.tsx | <HelpEntry /> | {null}
 * @mutate src/components/help/HelpEntry.tsx | if (!user \|\| pathname.startsWith("/admin")) return null; | if (pathname.startsWith("/admin")) return null;
 * @mutate src/components/help/HelpEntry.tsx | if (!user \|\| pathname.startsWith("/admin")) return null; | if (!user) return null;
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { HelpEntry } from "@/components/help/HelpEntry";
import { YouMenu } from "@/components/profile/profileLanding/YouMenu";
import { TAB_TITLES } from "@/pages/profile/types";
import { SUPPORT_REPLY_PROMISE } from "@/lib/supportTopics";
import { blankComments } from "./helpers/blankNonCode";

const auth = vi.hoisted(() => ({ user: { id: "u1" } as { id: string } | null }));
vi.mock("@/hooks/useCurrentUser", () => ({ useCurrentUser: () => ({ user: auth.user, profile: null, isAdmin: false }) }));
vi.mock("@/pages/home/homeDashboard/homeMoney", () => ({ useHomeMoney: () => ({ coming: null, held: null }) }));

const read = (p: string) => blankComments(readFileSync(p, "utf8")).replace(/\s+/g, " ");

function Where() {
  const l = useLocation();
  return <output data-testid="where">{l.pathname + l.search}</output>;
}

function mount(path = "/home") {
  render(
    <MemoryRouter initialEntries={[path]}>
      <HelpEntry />
      <Routes><Route path="*" element={<Where />} /></Routes>
    </MemoryRouter>,
  );
}

describe("the one Help entry", () => {
  beforeEach(() => {
    auth.user = { id: "u1" };
  });

  it("opens Get help now with the few-hours promise and goes to the talk-to-a-person form", async () => {
    mount();
    expect(screen.queryByText("Get help now")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Help" }));
    expect(await screen.findByText(SUPPORT_REPLY_PROMISE)).toBeTruthy();
    expect(SUPPORT_REPLY_PROMISE).toContain("within a few hours");
    fireEvent.click(screen.getByRole("button", { name: "Get help now" }));
    expect(screen.getByTestId("where").textContent).toBe("/support?topic=message");
    expect(screen.queryByText("Get help now")).toBeNull();
  });

  it("is not on a guest's screen", () => {
    auth.user = null;
    mount();
    expect(screen.queryByRole("button", { name: "Help" })).toBeNull();
  });

  it("is not in Admin", () => {
    mount("/admin?view=home");
    expect(screen.queryByRole("button", { name: "Help" })).toBeNull();
  });

  it("keeps the panel out of the first load: a dynamic import only", () => {
    const entry = read("src/components/help/HelpEntry.tsx");
    expect(entry).toContain('import("./HelpEntryPanel")');
    expect(entry).not.toContain("@/components/ui/popover");
    expect(entry).not.toContain("@/lib/supportTopics");
  });

  it("You > Help is one tap: the You menu's 'Talk to a real person' row (captioned Help) opens the Help screen", () => {
    const opened: string[] = [];
    render(
      <MemoryRouter>
        <YouMenu onSelectTab={(k) => opened.push(k)} onRequestLogout={() => {}} onRequestDelete={() => {}} />
      </MemoryRouter>,
    );
    const row = document.querySelector('[data-you-row="support"]') as HTMLElement;
    expect(row, "no Help row in the You menu").toBeTruthy();
    expect(row.textContent).toContain("Talk to a real person");
    expect(row.querySelector('[data-you-caption="support"]')?.textContent).toBe("Help");
    fireEvent.click(row);
    expect(opened).toEqual(["support"]);
    expect(TAB_TITLES.support).toBe("Help");
  });

  it("is mounted from the shared bars (the desktop top nav, a sub-screen's header), and no longer from the phone top bar", () => {
    expect(read("src/components/DesktopTopNav.tsx")).toContain("<HelpEntry />");
    expect(read("src/components/PageHeader.tsx")).toContain("<HelpEntry />");
    expect(read("src/components/sections/AppTopBar.tsx")).not.toContain("<HelpEntry");
  });
});
