/**
 * Audit 2026-10-28 P5-3: the Privacy Policy's short version said "We collect …
 * name, email, phone, ID, location" while ID checks are switched off
 * (feature_switches.identity_check = off), so it read as if every member hands
 * over an ID. The short version names ID only as asked for ("when we ask for
 * it", owner 2026-10-30), and the full policy still describes identity verification, so
 * the policy stays honest whether the switch is on or off.
 *
 * @mutate src/pages/info/legal/PrivacySection.tsx | name, email, phone, location, usage data, and ID, when we ask for it. | name, email, phone, ID, location, usage data.
 */
import { describe, it, expect, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

vi.mock("@/hooks/useAuthReady", () => ({ useAuthReady: () => ({ user: null, isReady: true }) }));
vi.mock("@/lib/haptics", () => ({ hapticError: vi.fn(), hapticLight: vi.fn() }));
vi.mock("@/lib/errorLogger", () => ({ report: vi.fn() }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: { from: vi.fn() } }));

import { PrivacyContent } from "./PrivacySection";

describe("Privacy short version: ID is optional, never listed as always collected", () => {
  it("the short-version line that names ID says it is only when we ask for it", () => {
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
    expect(collect).toMatch(/\bID, when we ask for it\b/);
    // ID appears in that line only in its optional form.
    expect(collect!.replace("ID, when we ask for it", "")).not.toMatch(/\bID\b/);
    // The full policy keeps its identity-verification section (honest if ID checks come back on).
    // Its rows are collapsed until opened, so read the source.
    expect(readFileSync(resolve(__dirname, "PrivacySection.tsx"), "utf8")).toMatch(/Identity verification:/);
  });
});
