/**
 * Landing design audit 2026-11-10 (~/.lh-shots/landing-design-1110/FINDINGS.md; owner: "the landing page doesn't seem
 * well organized, just thrown together"). The findings without a guard of their own elsewhere:
 *   - D001, D003, D006, D017: landingBrowseSwitch1108 / landingJustFinishedInJobs1109 / landingBrowsesDeclutter;
 *   - D005: landingOpeningSoonCopy; D008, D009, D012, D020 and the preview tweaks: landingDeclutterEqualWeight1109;
 *   - D019: src/components/ScrollToTop.button.test.tsx.
 * Here:
 *   D002: a middle type step. Every landing H2 is .landing-h2 (clamp 32 -> 48px), the close .landing-h2-close (40 ->
 *         56px); none is the flat 28px (text-ds-28) any more. The hero H1 keeps its own sizes.
 *   D010: the dark money band is its own colour (deep olive), never the dark surface (#262420) it vanished into.
 *   D015: no tracked-out ALL-CAPS template labels (LIVE NOW, POPULAR NOW, JUST FINISHED, YOUR MONEY PROTECTED).
 *   D016: no service-area line under the first section (owner 2026-11-11: removed "Serving New Iberia, Lafayette,
 *         Abbeville and nearby." from under "Browse jobs").
 *   D021: on a phone the landing's bar is the logo, Log in and Join free.
 *
 * @mutate src/index.css |   font-size: clamp(32px, 3.2vw, 48px); |   font-size: 28px;
 * @mutate src/components/landing/HowItWorksSection.tsx |             className="font-display landing-serif text-balance landing-h2" |             className="font-display landing-serif text-balance text-ds-28"
 * @mutate src/index.css |   --lp-band: #2E2F22; |   --lp-band: #262420;
 * @mutate src/components/landing/LandingProof.tsx |         <span className="text-ds-13 font-semibold" style={{ color: "var(--lp-action-strong)" }}> |         <span className="text-ds-13 font-semibold uppercase" style={{ color: "var(--lp-action-strong)" }}>
 * @mutate src/components/landing/LandingBrowseShell.tsx |         {children}\n | {children}<p>Serving New Iberia, Lafayette, Abbeville and nearby.</p>\n
 * @mutate src/components/Navbar.tsx |   const phoneHidden = landing ? " max-[639px]:hidden" : ""; |   const phoneHidden = "";
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

vi.mock("@/components/landing/useSectionsOpen", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/components/landing/useSectionsOpen")>();
  return { ...real, useSectionsOpen: () => ({ open: new Set(["declutter"]) }) };
});
vi.mock("@/lib/routePrefetch", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/lib/routePrefetch")>();
  return { ...real, whenPageSettled: () => () => {}, prefetchRoute: () => {} };
});
vi.mock("@/lib/socialAuth", () => ({ SOCIAL_SIGN_IN_ENABLED: false, signInWithProvider: vi.fn() }));
vi.mock("@/hooks/useAuthReady", () => ({ useAuthReady: () => ({ user: null, isReady: true, ready: true }) }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: { auth: { getSession: vi.fn(async () => ({ data: { session: null } })) } } }));
vi.mock("@/lib/jobColumns", () => ({ readJobsAheadOfDb: () => new Promise(() => {}) }));

import { SectionsShowcase, TrustAndJoin } from "@/components/landing/SectionsShowcase";
import HowItWorksSection from "@/components/landing/HowItWorksSection";
import { LiveJobsSection } from "@/components/landing/LiveJobsSection";
import FreshDeclutterStrip from "@/components/landing/FreshDeclutterStrip";
import Navbar from "@/components/Navbar";

const css = readFileSync(join(process.cwd(), "src/index.css"), "utf8");
const rule = (sel: string) => css.match(new RegExp(`\\n${sel.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&")} \\{([^}]*)\\}`))?.[1] ?? "";

const item = (n: number) => ({
  id: `i${n}`, title: `Thing ${n}`, category: "kitchen", condition_stars: 4, porch_ok: false, price_cents: 2000,
  current_price_cents: 2000, area_label: "Delcambre", photo: null, photoFull: null,
});

function allLanding() {
  return render(
    <MemoryRouter>
      <LiveJobsSection />
      <SectionsShowcase />
      <HowItWorksSection />
      <TrustAndJoin />
      <FreshDeclutterStrip items={[item(1), item(2)]} />
    </MemoryRouter>,
  );
}

describe("landing design audit 11-10", () => {
  it("D002: every landing H2 sits on the middle step; the close one step larger; none is the flat 28px", () => {
    expect(rule(".landing-h2")).toMatch(/font-size:\s*clamp\(32px,\s*3\.2vw,\s*48px\)/);
    expect(rule(".landing-h2-close")).toMatch(/font-size:\s*clamp\(40px,\s*5vw,\s*56px\)/);
    const { container, unmount } = allLanding();
    const h2s = [...container.querySelectorAll("h2")];
    expect(h2s.length).toBeGreaterThan(4);
    for (const h of h2s) {
      const c = h.className.split(/\s+/);
      expect(c, h.textContent!).not.toContain("text-ds-28");
      expect(c.includes("landing-h2") || c.includes("landing-h2-close"), h.textContent!).toBe(true);
    }
    expect(within(container).getByRole("heading", { level: 2, name: /Join your neighbors/ }).className).toContain("landing-h2-close");
    unmount();
  });

  it("D010: the dark money band is deep olive, not the dark section surface", () => {
    const dark = css.match(/\[data-theme="dark"\] \.landing-page \{([^}]*)\}/)?.[1] ?? "";
    const band = dark.match(/--lp-band:\s*(#[0-9A-Fa-f]{6})/)?.[1];
    const surface = dark.match(/--lp-surface:\s*(#[0-9A-Fa-f]{6})/)?.[1];
    expect(band).toBeTruthy();
    expect(surface).toBeTruthy();
    expect(band!.toUpperCase()).not.toBe(surface!.toUpperCase());
    expect(band!.toUpperCase()).toBe("#2E2F22");
  });

  it("D015: no ALL-CAPS template label anywhere below the hero", () => {
    const { container, unmount } = allLanding();
    const caps = [...container.querySelectorAll<HTMLElement>("*")].filter((e) => /\buppercase\b/.test(e.getAttribute("class") ?? ""));
    expect(caps.map((e) => e.textContent)).toEqual([]);
    expect(container.textContent).not.toMatch(/Live now|Popular now|Your money, protected/i);
    // Inventory floor: the sections did render.
    expect(container.querySelectorAll("section").length).toBeGreaterThan(3);
    unmount();
  });

  it("D016 (owner 2026-11-11): the first section carries no service-area line", () => {
    const { unmount } = render(<MemoryRouter><LiveJobsSection /></MemoryRouter>);
    const section = screen.getByTestId("landing-live-jobs");
    // Floor: the section did render its heading.
    expect(section.textContent?.length ?? 0).toBeGreaterThan(10);
    expect(section.textContent).not.toMatch(/Serving\b/);
    expect(section.textContent).not.toContain("Abbeville and nearby");
    unmount();
  });

  it("D021: on a phone the landing's bar is logo, Log in and Join free; other pages keep Jobs and Declutter", () => {
    const links = (landing: boolean) => {
      const { container, unmount } = render(<MemoryRouter><Navbar landing={landing} /></MemoryRouter>);
      const out = [...container.querySelectorAll("a")].map((a) => ({ text: a.textContent?.trim(), phoneHidden: /max-\[639px\]:hidden/.test(a.className) }));
      unmount();
      return out;
    };
    const onLanding = links(true);
    expect(onLanding.length).toBeGreaterThan(3);
    for (const l of onLanding) expect(l.phoneHidden, l.text).toBe(l.text === "Jobs" || l.text === "Declutter");
    for (const l of links(false)) expect(l.phoneHidden, l.text).toBe(false);
  });
});
