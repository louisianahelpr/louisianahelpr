/**
 * The owner's UI audit of the landing (2026-11-09, ~/.lh-shots/ui-audit-1109), one block per finding.
 *
 * F003: the Declutter card said "Offers and checkout happen in the app.", which reads wrong on the website, where a
 * visitor can browse and buy. It now says they are built in.
 * @mutate src/components/landing/SectionsShowcase.tsx | Offers and checkout are built in. | Offers and checkout happen in the app.
 *
 * F004: the four section cards were grey-beige fills (var(--lp-ground)) beside the white How a job works cards. They
 * wear the same white landing card with its soft shadow (.landing-card: var(--lp-surface) + var(--lp-shadow)).
 * @mutate src/components/landing/SectionsShowcase.tsx | className="landing-card relative p-6 | className="relative rounded-[20px] p-6
 * @mutate src/components/landing/SectionsShowcase.tsx | scroll-mt-24" style={{ background: "var(--lp-ground)" | scroll-mt-24" style={{ background: "var(--lp-surface)"
 *
 * F016: "Continue with Apple" appeared a moment after the rest of the join block and pushed "Create your free account"
 * sideways (desktop) or up (phone). An invisible slot with the button's own box and label holds its place until the
 * lazily loaded button has arrived, both before it is asked for and while its chunk is in flight.
 * @mutate src/components/landing/SectionsShowcase.tsx | <Suspense fallback={<AppleSlot />}> | <Suspense fallback={null}>
 * @mutate src/components/landing/SectionsShowcase.tsx |             ) : (\n              <AppleSlot />\n            )} |             ) : null}
 *
 * F027: the landing's Continue with Apple was a white button; Sign up and Log in show the solid ink one (Apple's own
 * black/white pair, SocialAuthButtons board 37/55). The landing now wears the same fill and text colour, read from
 * SocialAuthButtons' own style so the two cannot drift apart.
 * @mutate src/components/landing/LandingAppleButton.tsx | style={{ backgroundColor: "hsl(var(--foreground))", color: "hsl(var(--background))", | style={{ backgroundColor: "var(--lp-surface)", color: "var(--lp-ink)",
 *
 * F005: the footer's Facebook (bright blue) and Instagram (rainbow gradient) chips were off brand. Every social chip is
 * the olive monochrome chip (olivewood fill, parchment glyph), with no brand colour or gradient of its own.
 * @mutate src/components/Footer.tsx | rounded-full bg-[hsl(var(--olivewood))] text-[hsl(var(--parchment))] shadow-sm transition-all duration-300 ease-out hover:brightness-110"\n              aria-label={w("footer.facebook", "Follow us on Facebook | rounded-full bg-[hsl(var(--facebook))] text-white shadow-sm transition-all duration-300 ease-out hover:brightness-110"\n              aria-label={w("footer.facebook", "Follow us on Facebook
 *
 * F006: the footer's links and tagline were 11px, and the links 16px tall tap targets. They are 13px, and every link
 * has a 44px tall tap area on a touch screen (pointer: coarse).
 * @mutate src/components/Footer.tsx | const FOOTER_LINK = "link-standard inline-flex items-center min-h-11"; | const FOOTER_LINK = "link-standard";
 * @mutate src/components/Footer.tsx |           <p className="text-ds-13 text-[hsl(var(--olivewood))]/80 max-w-xs | <p className="text-ds-11 text-[hsl(var(--olivewood))]/80 max-w-xs
 *
 * F008: How a job works' "I need help / I want to work" switch had 11px labels. It uses SegmentedControl's 13px label
 * size on the landing; every segment keeps the control's 44px row (h-11 min-h-11).
 * @mutate src/components/landing/HowItWorksSection.tsx |             labelSize="md"\n |
 * @mutate src/components/ui/SegmentedControl.tsx |               labelSize === "md" ? "text-ds-13" : "text-ds-11", |               "text-ds-11",
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const state = vi.hoisted(() => ({ open: null as ReadonlySet<string> | null }));
vi.mock("@/components/landing/useSectionsOpen", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/components/landing/useSectionsOpen")>();
  return { ...real, useSectionsOpen: () => ({ open: state.open }) };
});

const settle = vi.hoisted(() => ({ fire: false }));
vi.mock("@/lib/routePrefetch", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/lib/routePrefetch")>();
  return { ...real, whenPageSettled: (cb: () => void) => { if (settle.fire) cb(); return () => {}; } };
});
vi.mock("@/lib/socialAuth", () => ({ SOCIAL_SIGN_IN_ENABLED: true, signInWithProvider: vi.fn() }));
vi.mock("@/hooks/useAuthReady", () => ({ useAuthReady: () => ({ user: null, ready: true }) }));
import Footer from "@/components/Footer";

import { LANDING_CARD_KEYS, SectionsShowcase, TrustAndJoin } from "@/components/landing/SectionsShowcase";

function renderSections(open: ReadonlySet<string> | null) {
  state.open = open;
  return render(<MemoryRouter><SectionsShowcase /></MemoryRouter>);
}

describe("landing UI audit 2026-11-09", () => {
  it("F003: the Declutter card says offers and checkout are built in", () => {
    const { container, unmount } = renderSections(new Set(["declutter"]));
    // D005 (11-10): the open pair as cards (LANDING_CARD_KEYS), the rest in one line.
    expect(container.querySelectorAll("[data-section]").length).toBe(LANDING_CARD_KEYS.length);
    const card = container.querySelector('[data-section="declutter"]') as HTMLElement;
    expect(card.textContent).toContain("Sell to neighbors or find a deal. Offers and checkout are built in.");
    expect(container.textContent).not.toMatch(/happen in the app/);
    unmount();
  });

  it("F004: every section card is the white landing card (the How a job works surface), never the ground fill", () => {
    const css = readFileSync(resolve(__dirname, "../index.css"), "utf8");
    const rule = css.match(/\n\.landing-card \{([^}]*)\}/)?.[1] ?? "";
    expect(rule).toMatch(/background:\s*var\(--lp-surface\)/);
    expect(rule).toMatch(/box-shadow:\s*var\(--lp-shadow\)/);
    const { container, unmount } = renderSections(null);
    const cards = [...container.querySelectorAll<HTMLElement>("[data-section]")];
    expect(cards.length).toBeGreaterThan(1);
    for (const c of cards) {
      expect(c.classList.contains("landing-card"), c.dataset.section).toBe(true);
      expect(c.style.background, c.dataset.section).toBe("");
    }
    // The section sits on the page ground, so the white cards stand out (lead 11-09: on the white surface they read faint).
    expect((container.querySelector("#sections") as HTMLElement).style.background).toBe("var(--lp-ground)");
    unmount();
  });

  describe("F016: the Apple button's place is held before it arrives", () => {
    const BOX = ["h-14", "w-full", "sm:w-auto", "px-7", "rounded-full", "text-ds-15", "font-semibold"];
    // An observer that never reports the join block on screen: the close is below the fold.
    class NeverSeen {
      observe() {}
      disconnect() {}
      unobserve() {}
      takeRecords() { return []; }
    }
    afterEach(() => {
      vi.unstubAllGlobals();
      settle.fire = false;
    });

    it("the slot has the real button's box and label", () => {
      const button = readFileSync(resolve(__dirname, "../components/landing/LandingAppleButton.tsx"), "utf8");
      const buttonClass = button.match(/className="([^"]*h-14[^"]*)"/)?.[1] ?? "";
      for (const c of BOX) expect(buttonClass.split(" "), c).toContain(c);
    });

    it("before the page settles and before the close is seen: the slot holds the place, invisible and hidden from readers", () => {
      vi.stubGlobal("IntersectionObserver", NeverSeen);
      const { unmount } = render(<MemoryRouter><TrustAndJoin /></MemoryRouter>);
      const slot = screen.getByTestId("landing-apple-slot");
      expect(slot.getAttribute("aria-hidden")).toBe("true");
      expect(slot.classList.contains("invisible")).toBe(true);
      for (const c of BOX) expect(slot.classList.contains(c), c).toBe(true);
      expect(slot.textContent).toBe("Continue with Apple");
      expect(screen.queryByTestId("landing-apple")).toBeNull();
      unmount();
    });

    it("once the page settles: the slot stays while the chunk loads, then the button takes its place", async () => {
      vi.stubGlobal("IntersectionObserver", NeverSeen);
      settle.fire = true;
      const { unmount } = render(<MemoryRouter><TrustAndJoin /></MemoryRouter>);
      expect(screen.getByTestId("landing-apple-slot")).toBeTruthy();
      expect(await screen.findByTestId("landing-apple")).toBeTruthy();
      expect(screen.queryByTestId("landing-apple-slot")).toBeNull();
      unmount();
    });
  });

  it("F005: every footer social chip is the olive monochrome chip, no brand colour or gradient", () => {
    const { container, unmount } = render(<MemoryRouter><Footer /></MemoryRouter>);
    const chips = [...container.querySelectorAll<HTMLAnchorElement>('a[target="_blank"][aria-label^="Follow us on"]')];
    expect(chips.length).toBeGreaterThan(1);
    for (const a of chips) {
      const label = a.getAttribute("aria-label")!;
      expect(a.className, label).toContain("bg-[hsl(var(--olivewood))]");
      expect(a.className, label).toContain("text-[hsl(var(--parchment))]");
      expect(a.className, label).not.toMatch(/--facebook|text-white/);
      expect(a.style.backgroundImage, label).toBe("");
    }
    unmount();
  });

  it("F006: footer links and tagline are 13px, and every link has a 44px tap area on touch", () => {
    const { container, unmount } = render(<MemoryRouter><Footer /></MemoryRouter>);
    const links = [...container.querySelectorAll<HTMLAnchorElement>("footer ul a")];
    // Jobs, Declutter, Help center, Contact us, Terms, Rules, Privacy.
    expect(links.length).toBeGreaterThan(6);
    for (const a of links) {
      expect(a.closest("ul")!.className, a.textContent!).toContain("text-ds-13");
      expect(a.className.split(" "), a.textContent!).toContain("min-h-11"); // every pointer since F214 (11-10)
      expect(a.className.split(" "), a.textContent!).toContain("inline-flex");
    }
    const tagline = [...container.querySelectorAll("footer p")].find((p) => /for Louisiana\.$/.test(p.textContent ?? ""))!;
    expect(tagline.className).toContain("text-ds-13");
    expect(container.innerHTML).not.toMatch(/<(ul|a)[^>]*text-ds-11/);
    unmount();
  });

  it("F008: How a job works' side switch has 13px labels on a 44px row", async () => {
    const { default: HowItWorksSection } = await import("@/components/landing/HowItWorksSection");
    const { unmount } = render(<MemoryRouter><HowItWorksSection /></MemoryRouter>);
    const tabs = within(screen.getByRole("tablist", { name: "Which side of Helpr are you on" })).getAllByRole("tab");
    expect(tabs.map((t) => t.textContent)).toEqual(["I need help", "I want to work", "Buy or sell"]);
    for (const t of tabs) {
      const cls = t.className.split(" ");
      expect(cls, t.textContent!).toContain("text-ds-13");
      expect(cls, t.textContent!).not.toContain("text-ds-11");
      expect(cls, t.textContent!).toContain("h-11");
      expect(cls, t.textContent!).toContain("min-h-11");
    }
    unmount();
  });

  it("F027: the landing's Apple button has Sign up's solid ink fill and text colour", async () => {
    const social = readFileSync(resolve(__dirname, "../components/auth/SocialAuthButtons.tsx"), "utf8");
    const m = social.match(/provider === "apple" \? \{ backgroundColor: "([^"]+)", color: "([^"]+)" \}/);
    expect(m, "SocialAuthButtons' Apple style moved: update this guard").not.toBeNull();
    const [, fill, ink] = m!;
    const { default: LandingAppleButton } = await import("@/components/landing/LandingAppleButton");
    const { unmount } = render(<LandingAppleButton />);
    const button = screen.getByTestId("landing-apple");
    expect(button.style.backgroundColor).toBe(fill);
    expect(button.style.color).toBe(ink);
    unmount();
  });
});
