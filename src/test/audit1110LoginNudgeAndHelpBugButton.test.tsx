/**
 * Whole-app audit 11-10, Builder 2:
 *   F259g /login: after a wrong email or password, the nudge was a second small "Forgot password?" link squeezed
 *         between the error words and the one on the Password row. It is now a full-width outline button on its own
 *         line: "Forgot your password? We can email you a reset link." (still /forgot-password, still carrying the email).
 *   F232 /help: "Report a bug" was an 88x19 text link; it is a full-width outline button (44px tap box).
 *
 * @mutate src/pages/auth/loginForgotNudge.tsx | <Link to="/forgot-password" state={state} data-login-forgot-nudge=""> | <Link to="/forgot-password" data-login-forgot-nudge="">
 * @mutate src/pages/auth/loginForgotNudge.tsx |     <Button asChild variant="outline" size="wrapSm" className="basis-full mt-1 text-ds-13"> |     <Button asChild variant="ghost" size="sm" className="mt-1 text-ds-13">
 * @mutate src/lib/i18n/enScreens.ts |   "login.forgotNudge": "Forgot your password? We can email you a reset link.", |   "login.forgotNudge": "Forgot password?",
 * @mutate src/pages/info/HelpCenter.tsx |             <Button asChild variant="outline" size="md" className="w-full"> |             <Button asChild variant="outline" size="md" className="w-auto">
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { blankComments } from "./helpers/blankNonCode";

vi.mock("sonner", () => ({ toast: Object.assign(vi.fn(), { error: vi.fn(), success: vi.fn() }) }));
vi.mock("@/hooks/useCaptcha", () => ({
  useCaptcha: () => ({ ref: { current: null }, run: <T,>(fn: (token: string | undefined) => Promise<T>) => fn(undefined) }),
}));
vi.mock("@/components/auth/TurnstileField", () => ({ TurnstileField: () => null }));
vi.mock("@/lib/loginTransport", () => ({
  signInWithTimeout: async () => ({ data: { session: null }, error: new Error("Invalid login credentials") }),
  isTransportFailure: () => false,
}));
vi.mock("@/lib/haptics", () => ({ hapticMedium: () => {}, hapticSuccess: () => {}, hapticError: () => {} }));
vi.mock("@/hooks/usePageMeta", () => ({ usePageMeta: () => {} }));

import Login from "@/pages/auth/Login";
import { enScreens } from "@/lib/i18n/enScreens";
import { es } from "@/lib/i18n/es";

afterEach(() => cleanup());

const NUDGE = "Forgot your password? We can email you a reset link.";

describe("F259g: the wrong-password nudge is a full-width button that offers the reset link", () => {
  it("renders the nudge as an outline button under the words, linking to /forgot-password with the typed email", async () => {
    localStorage.clear();
    const { container } = render(
      <QueryClientProvider client={new QueryClient()}>
        <MemoryRouter initialEntries={["/login"]}>
          <Login />
        </MemoryRouter>
      </QueryClientProvider>,
    );
    fireEvent.change(container.querySelector("#email")!, { target: { value: "dana@example.com" } });
    fireEvent.change(container.querySelector("#password")!, { target: { value: "not-the-password" } });
    fireEvent.submit(container.querySelector("form")!);
    const alert = await waitFor(() => {
      const el = container.querySelector("[data-login-cred-error]") as HTMLElement | null;
      expect(el).not.toBeNull();
      return el!;
    });
    const nudge = alert.querySelector("a[data-login-forgot-nudge]") as HTMLAnchorElement | null;
    expect(nudge).not.toBeNull();
    expect(nudge!.textContent).toBe(NUDGE);
    expect(nudge!.getAttribute("href")).toBe("/forgot-password");
    // Its own full line, a 44px tap box, outline styling (the shared Button classes land on the <a> via asChild).
    expect(nudge!.className).toContain("basis-full");
    expect(nudge!.className).toContain("min-h-11");
    expect(nudge!.className).toContain("border");
    // One nudge, not two "Forgot password?" links in the error.
    expect(alert.querySelectorAll("a").length).toBe(1);
    expect(alert.textContent).not.toMatch(/Forgot password\?/);
  });

  it("the Password-row link keeps the short 'Forgot password?' and the nudge carries the typed email in router state", () => {
    expect(blankComments(readFileSync("src/pages/auth/Login.tsx", "utf8"))).toMatch(/<LoginForgotNudge state=\{forgotState\} \/>/);
    const src = blankComments(readFileSync("src/pages/auth/loginForgotNudge.tsx", "utf8"));
    expect(src).toMatch(/<Link to="\/forgot-password" state=\{state\} data-login-forgot-nudge="">\s*\{t\("login\.forgotNudge"\)\}/);
    expect(enScreens["login.forgot"]).toBe("Forgot password?");
    expect(enScreens["login.forgotNudge"]).toBe(NUDGE);
    expect(es["login.forgotNudge"]).toMatch(/^¿Olvidó su contraseña\? /);
  });
});

describe("F232: the help centre's Report a bug is a full-width button", () => {
  it("wraps the /support?topic=report link in a w-full outline Button", () => {
    const src = blankComments(readFileSync("src/pages/info/HelpCenter.tsx", "utf8"));
    const m = src.match(/<Button asChild variant="outline" size="md" className="([^"]*)">\s*<Link to="\/support\?topic=report" data-help-report-bug="">Report a bug<\/Link>/);
    expect(m).not.toBeNull();
    expect(m![1].split(/\s+/)).toContain("w-full");
    // The old inline text link is gone.
    expect(src).not.toMatch(/Something not working\?\{" "\}/);
  });
});
