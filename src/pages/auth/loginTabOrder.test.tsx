/**
 * Q2248: Log in's "Forgot password?" link sat on the Password label's row BEFORE the password field in the DOM, so Tab
 * from Email landed on the link. The link still shows on that row (a grid places it) but comes after the field: Tab from
 * Email reaches Password first.
 *
 * @mutate src/pages/auth/Login.tsx |             <Label htmlFor="password" className="col-start-1 row-start-1 text-ds-13 font-sans font-medium">{t("login.password")}</Label>\n | <Label htmlFor="password" className="col-start-1 row-start-1 text-ds-13 font-sans font-medium">{t("login.password")}</Label><Link to="/forgot-password">{t("login.forgot")}</Link>\n
 */
import { describe, expect, it, vi } from "vitest";
import { render } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

vi.mock("@/integrations/supabase/client", () => ({
  supabase: { auth: { onAuthStateChange: vi.fn(() => ({ data: { subscription: { unsubscribe: () => {} } } })), getSession: vi.fn(async () => ({ data: { session: null }, error: null })) } },
}));
vi.mock("@/hooks/useCaptcha", () => ({
  useCaptcha: () => ({ run: (fn: (t: string) => unknown) => fn("tok"), enabled: false, ready: true, token: "tok", setToken: () => {}, reset: () => {} }),
}));
vi.mock("@/components/auth/TurnstileField", () => ({ TurnstileField: () => null }));
vi.mock("@/components/auth/SocialAuthButtons", () => ({ SocialAuthButtons: () => null }));

import Login from "./Login";

describe("Q2248: Tab from Email reaches Password before Forgot password", () => {
  it("the tab stops after Email run Password, then the recovery link", () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(<MemoryRouter initialEntries={["/login"]}><QueryClientProvider client={qc}><Login /></QueryClientProvider></MemoryRouter>);
    const form = (document.getElementById("password") as HTMLInputElement).closest("form") as HTMLFormElement;
    const stops = [...form.querySelectorAll<HTMLElement>("input, a[href], button")]
      .filter((el) => !el.hasAttribute("disabled") && el.tabIndex >= 0 && el.getAttribute("type") !== "hidden");
    const ids = stops.map((el) => el.id || el.getAttribute("href") || el.getAttribute("aria-label") || el.textContent?.trim() || el.tagName);
    const email = stops.findIndex((el) => el.getAttribute("type") === "email" || el.id === "email");
    expect(email).toBeGreaterThanOrEqual(0);
    expect(ids[email + 1]).toBe("password");
    const link = ids.indexOf("/forgot-password");
    expect(link).toBeGreaterThan(email + 1);
    expect(stops.length).toBeGreaterThan(3);
  });
});
