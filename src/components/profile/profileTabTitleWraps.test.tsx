/**
 * NIGHT-SET-Declutterse-7 (audit 2026-10-31): the Profile tab title was cut off at 375, "Declutter setti..." on
 * Declutter settings and "Account and secur..." on Account and security (360: "Account and sec..."). Both come
 * from ONE shared header, ProfileTabHeader (Profile tabs, and AppPage's sub-screens through it), which forwarded
 * PageHeader's default one-line `truncate` title. It now asks PageHeader to wrap (`wrapTitle`, break-words) unless a caller turns it off.
 *
 * @mutate src/components/profile/ProfileTabHeader.tsx | sticky, wrapTitle = true } | sticky, wrapTitle }
 */
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { ProfileTabHeader } from "./ProfileTabHeader";

const titles = ["Declutter settings", "Account and security"];
const wrap = (ui: ReactNode) => render(<QueryClientProvider client={new QueryClient()}><MemoryRouter>{ui}</MemoryRouter></QueryClientProvider>);

describe("ProfileTabHeader: a long title wraps, never ends in ...", () => {
  for (const title of titles) {
    it(title, () => {
      wrap(<ProfileTabHeader title={title} backTo="/profile" />);
      const h1 = screen.getByRole("heading", { level: 1, name: title });
      expect(h1.className).not.toMatch(/\btruncate\b/);
      expect(h1.className).toMatch(/\bbreak-words\b/);
    });
  }
  it("the sticky form wraps too", () => {
    wrap(<ProfileTabHeader title={titles[0]} backTo="/profile" sticky />);
    expect(screen.getByRole("heading", { level: 1, name: titles[0] }).className).not.toMatch(/\btruncate\b/);
  });
});
