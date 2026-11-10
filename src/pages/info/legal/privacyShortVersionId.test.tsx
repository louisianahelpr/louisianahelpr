/**
 * Audit 2026-10-28 P5-3: the Privacy Policy's short version said "We collect … name, email, phone, ID, location" while
 * ID checks were switched off, so it read as if every member hands over an ID. The short version names ID as optional
 * ("if you choose to verify it") while the switch is off.
 *
 * L003 (landing audit 11-09, High): with the switch ON for everyone (prod, 11-09) a SIGNED-OUT visitor still read "if
 * you choose to verify it" (the member's own switch answer is false signed out), and "when we ask for it" never said
 * the real rule. Now the line follows the switch for THIS viewer (useIdCheckOnForViewer: a guest reads whether
 * identity_check is open to everyone) and, while it is on, states the owner's rule (OWNER-DECISIONS.md, 10-30): a photo
 * ID, checked once per account, at the first job posted, hire or delivery, listing or purchase. The Terms short version
 * says the same (src/test/legalIdOncePerAccount.test.tsx).
 *
 * @mutate src/pages/info/legal/PrivacySection.tsx | usage data, and ${idCheckOn ? ID_ONCE_PER_ACCOUNT : "ID, if you choose to verify it"}. | usage data, and ID, if you choose to verify it.
 * @mutate src/lib/useIdCheckOnForViewer.ts |   if (guest) return open === null ? ID_CHECK_BEFORE_ANSWER : open.has("identity_check"); |   if (guest) return member;
 */
import { afterEach, describe, it, expect, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { cleanup, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

const state = vi.hoisted(() => ({ signedIn: false, open: new Set<string>() }));
vi.mock("@/hooks/useAuthReady", () => ({ useAuthReady: () => ({ user: state.signedIn ? { id: "u1" } : null, isReady: true }) }));
vi.mock("@/components/landing/useSectionsOpen", () => ({ useSectionsOpen: () => ({ open: state.open, settled: true, failed: false }) }));
vi.mock("@/lib/haptics", () => ({ hapticError: vi.fn(), hapticLight: vi.fn() }));
vi.mock("@/lib/errorLogger", () => ({ report: vi.fn() }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: { from: vi.fn() } }));

import { PrivacyContent } from "./PrivacySection";
import { setIdentityCheckOn } from "@/lib/identityCheckSwitch";

function collectLine(): string {
  render(
    <MemoryRouter>
      <PrivacyContent />
    </MemoryRouter>,
  );
  const shortCard = screen.getByText("The short version").closest("div.rounded-\\[20px\\]") as HTMLElement;
  expect(shortCard).toBeTruthy();
  const items = [...shortCard.querySelectorAll("li")].map((li) => li.textContent ?? "");
  expect(items.length).toBeGreaterThan(2);
  const collect = items.find((t) => /We collect/.test(t));
  expect(collect).toBeTruthy();
  return collect as string;
}

const RULE = /a photo ID, checked once per account: the first time you post a job, get hired or take a delivery, list an item, or buy one/;

describe("Privacy short version: the ID line says the real rule for whoever reads it", () => {
  afterEach(() => {
    cleanup();
    setIdentityCheckOn(false);
    state.signedIn = false;
    state.open = new Set();
  });

  it("switch off (member): ID only if you choose to verify it", () => {
    state.signedIn = true;
    const collect = collectLine();
    expect(collect).toMatch(/\bID, if you choose to verify it\b/);
    expect(collect).not.toMatch(RULE);
    // The full policy keeps its identity-verification section. Its rows are collapsed until opened, so read the source.
    expect(readFileSync(resolve(__dirname, "PrivacySection.tsx"), "utf8")).toMatch(/Identity verification:/);
  });

  it("switch on (member): one photo ID check per account, and when", () => {
    state.signedIn = true;
    setIdentityCheckOn(true);
    const collect = collectLine();
    expect(collect).toMatch(RULE);
    expect(collect).not.toMatch(/choose to verify/);
  });

  it("L003: a signed-out visitor while the ID check is open to everyone reads the same rule", () => {
    state.open = new Set(["identity_check", "declutter"]);
    const collect = collectLine();
    expect(collect).toMatch(RULE);
    expect(collect).not.toMatch(/choose to verify/);
  });

  it("a signed-out visitor while it is not open to everyone: optional", () => {
    state.open = new Set(["declutter"]);
    expect(collectLine()).toMatch(/\bID, if you choose to verify it\b/);
  });
});
