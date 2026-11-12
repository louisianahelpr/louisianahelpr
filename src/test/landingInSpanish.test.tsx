/**
 * F260q (owner 11-11 ~2:10 PM, OWNER-DECISIONS.md "Spanish everything"): the landing under the hero (section cards,
 * money band, join block) speaks Spanish when the visitor picks it. It draws its own English and reads only the
 * Spanish (useGuestSpanish.ts), so first paint imports no i18n module; enLanding.ts mirrors the English word for word.
 *
 * @mutate src/components/landing/SectionsShowcase.tsx |   const w = (key: string, english: string) => es?.[key] ?? english; |   const w = (key: string, english: string) => (void key, english);
 * @mutate src/components/landing/SectionsShowcase.tsx |                 {w(`landing.trust.${key}`, title)} |                 {title}
 * @mutate src/components/landing/SectionsShowcase.tsx |     if (!es) return onTheWayLine(labels); |     return onTheWayLine(labels);
 */
import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { blankComments } from "./helpers/blankNonCode";

const state = vi.hoisted(() => ({ open: new Set(["identity_check", "declutter"]) as ReadonlySet<string> | null }));
vi.mock("@/components/landing/useSectionsOpen", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/components/landing/useSectionsOpen")>();
  return { ...real, useSectionsOpen: () => ({ open: state.open, settled: state.open !== null, failed: false }) };
});
vi.mock("@/lib/routePrefetch", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/lib/routePrefetch")>();
  return { ...real, whenPageSettled: () => () => {} };
});
vi.mock("@/lib/socialAuth", () => ({ SOCIAL_SIGN_IN_ENABLED: false, signInWithProvider: vi.fn() }));
vi.mock("@/hooks/useAuthReady", () => ({ useAuthReady: () => ({ user: null, isReady: true }) }));

import { SectionsShowcase, TrustAndJoin } from "@/components/landing/SectionsShowcase";
import { enLanding } from "@/lib/i18n/enLanding";
import { esLanding } from "@/lib/i18n/esLanding";

const SRC = "src/components/landing/SectionsShowcase.tsx";
const src = blankComments(readFileSync(SRC, "utf8"));
const literalPairs = [...src.matchAll(/\bw\("([\w.]+)", "([^"]+)"\)/g)].map((m) => [m[1], m[2]] as const);

beforeEach(() => window.localStorage.clear());
afterEach(() => {
  cleanup();
  window.localStorage.clear();
  state.open = new Set(["identity_check", "declutter"]);
});

const renderLanding = () => render(<MemoryRouter><SectionsShowcase /><TrustAndJoin /></MemoryRouter>);

describe("F260q: the landing under the hero speaks the visitor's language", () => {
  it("the English written in the landing is enLanding's, word for word", () => {
    expect(literalPairs.length).toBeGreaterThan(14);
    for (const [k, english] of literalPairs) expect(enLanding[k as keyof typeof enLanding], k).toBe(english);
  });

  it("first paint: the landing imports no i18n module", () => {
    expect(src).not.toMatch(/^import .*@\/lib\/i18n/m);
  });

  it("English: every visible word is enLanding's English (the card blurbs, steps and badges included)", async () => {
    window.localStorage.setItem("helpr_lang", "en");
    renderLanding();
    await new Promise((r) => setTimeout(r, 30));
    const text = document.body.textContent ?? "";
    for (const k of ["landing.blurb.jobs", "landing.blurb.declutter", "landing.step1Title", "landing.step2Body", "landing.trust.id", "landing.trust.made", "landing.moneyHeadline"] as const) {
      expect(text, k).toContain(enLanding[k]);
    }
  });

  it("Spanish saved: no English landing word is left on screen", async () => {
    window.localStorage.setItem("helpr_lang", "es");
    state.open = new Set(["identity_check", "declutter"]);
    renderLanding();
    await waitFor(() => expect(screen.getByText(esLanding["landing.sectionsHeading"])).toBeTruthy());
    const text = document.body.textContent ?? "";
    const visible = Object.entries(enLanding).filter(([k]) => !/Label$|startHere|^landing\.name\.|onTheWay|^landing\.and$/.test(k));
    const left = visible.filter(([k, english]) => esLanding[k as keyof typeof esLanding] !== english && text.includes(english.replace("{hours}", "")));
    expect(left.map(([k]) => k)).toEqual([]);
    expect(text).toContain(esLanding["landing.trust.id"]);
    expect(text).toMatch(/Si no ha respondido en \d+ horas/);
    // Shops and Homes, still on the way, are named in Spanish.
    expect(text).toContain("Tiendas y Casas llegan pronto.");
    expect(screen.getByRole("list", { name: esLanding["landing.trustLabel"] })).toBeTruthy();
  });
});
