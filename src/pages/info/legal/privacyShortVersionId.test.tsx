/**
 * Audit 2026-10-28 P5-3: the Privacy Policy's short version said "We collect …
 * name, email, phone, ID, location" while ID checks are switched off
 * (feature_switches.identity_check = off), so it read as if every member hands
 * over an ID. The short version names ID as optional ("if you choose to verify it")
 * while the switch is off and as asked for ("when we ask for it") only once it is on
 * (owner 2026-10-30); the full policy still describes identity verification, so the
 * policy stays honest whether the switch is on or off.
 *
 * @mutate src/pages/info/legal/PrivacySection.tsx | usage data, and ID, ${idCheckOn ? "when we ask for it" : "if you choose to verify it"}. | usage data, and ID, when we ask for it.
 */
import { afterEach, describe, it, expect, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { cleanup, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

vi.mock("@/hooks/useAuthReady", () => ({ useAuthReady: () => ({ user: null, isReady: true }) }));
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

describe("Privacy short version: ID is never listed as always collected", () => {
  afterEach(() => { cleanup(); setIdentityCheckOn(false); });

  it("switch off: the line says only if you choose to verify, and never that we ask", () => {
    const collect = collectLine();
    expect(collect).toMatch(/\bID, if you choose to verify it\b/);
    expect(collect).not.toMatch(/when we ask/);
    expect(collect.replace("ID, if you choose to verify it", "")).not.toMatch(/\bID\b/);
    // The full policy keeps its identity-verification section (honest if ID checks come back on).
    // Its rows are collapsed until opened, so read the source.
    expect(readFileSync(resolve(__dirname, "PrivacySection.tsx"), "utf8")).toMatch(/Identity verification:/);
  });

  it("switch on: the line says when we ask for it", () => {
    setIdentityCheckOn(true);
    const collect = collectLine();
    expect(collect).toMatch(/\bID, when we ask for it\b/);
    expect(collect).not.toMatch(/choose to verify/);
  });
});
