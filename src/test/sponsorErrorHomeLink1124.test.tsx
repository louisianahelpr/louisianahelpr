/**
 * Flow audit 1123 C8: when sponsor_public_state fails, /25days and /sponsor show a full-page error whose only way out
 * was an email address. It now links home (2026-11-24, like the 404 page's "Go home").
 *
 * @mutate src/pages/sponsor/SponsorPage.tsx |           <p><Link to="/" data-sponsor-error-home="">Go home</Link></p> |
 */
import { cleanup, render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/sponsor/api", async (orig) => {
  const real = await orig<typeof import("@/lib/sponsor/api")>();
  const failing = { publicState: () => Promise.reject(new Error("offline")) };
  return { ...real, sponsorBackend: () => Promise.resolve(failing) };
});

import SponsorPage from "@/pages/sponsor/SponsorPage";

afterEach(() => cleanup());

describe("/25days and /sponsor: the load error links home", () => {
  for (const path of ["/25days", "/sponsor"]) {
    it(path, async () => {
      const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
      render(
        <QueryClientProvider client={qc}>
          <MemoryRouter initialEntries={[path]}>
            <Routes>
              <Route path={path} element={<SponsorPage />} />
              <Route path="/" element={<p>home page</p>} />
            </Routes>
          </MemoryRouter>
        </QueryClientProvider>,
      );
      expect(await screen.findByText("We couldn't load this page. Check your connection and try again.")).toBeTruthy();
      const home = screen.getByRole("link", { name: "Go home" });
      expect(home.getAttribute("href")).toBe("/");
      home.click();
      expect(await screen.findByText("home page")).toBeTruthy();
    });
  }
});
