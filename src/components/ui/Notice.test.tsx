/**
 * M1 (iOS design audit 11-16): "Your page is hidden right now, so others can't open it. Ask us why" was loose text
 * between cards on Home, Selling and You (one component, YourPageLink, on all three). It is now the shared Notice
 * card: an icon, the title, the REASON and one action, and for an unconfirmed email the action is where to fix it.
 *
 * @mutate src/components/profile/YourPageLink.tsx |     const emailUnconfirmed = profile?.email_verified === false; |     const emailUnconfirmed = false;
 * @mutate src/components/profile/YourPageLink.tsx |       <Notice\n        data-your-page-link="" |       <div\n        data-your-page-link=""
 * @mutate src/components/ui/Notice.tsx |         {action && <div data-notice-action="" className="mt-3">{action}</div>} |
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { EyeOff } from "lucide-react";

const who = vi.hoisted(() => ({ profile: { email_verified: false } as { email_verified: boolean } | null }));
vi.mock("@/hooks/useCurrentUser", () => ({ useCurrentUser: () => ({ user: { id: "u1" }, profile: who.profile }) }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: { rpc: async (fn: string) => (fn === "public_profile_by_handle" ? { data: null, error: null } : { data: "eli-b", error: null }) } }));
vi.mock("sonner", () => ({ toast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn() }) }));

import { Notice } from "./Notice";
import { YourPageLink } from "@/components/profile/YourPageLink";

beforeEach(() => { who.profile = { email_verified: false }; });

function mountLink() {
  return render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MemoryRouter><YourPageLink knownHandle="eli-b" name="Eli" /></MemoryRouter>
    </QueryClientProvider>,
  );
}

describe("the shared Notice", () => {
  it("draws the title, the reason and the action, with the icon", () => {
    const { container } = render(<Notice title="T" icon={EyeOff} action={<a href="/x">Fix it</a>}>Because.</Notice>);
    expect(container.querySelector("[data-notice=info]")).not.toBeNull();
    expect(container.querySelector("svg")).not.toBeNull();
    expect(screen.getByText("Because.")).toBeTruthy();
    expect(container.querySelector("[data-notice-action]")?.textContent).toBe("Fix it");
  });
});

describe("Your page hidden (M1): the reason and the one thing to do", () => {
  it("email not confirmed: says so and points at Account and security", async () => {
    const { container } = mountLink();
    await waitFor(() => expect(container.querySelector("[data-your-page-hidden]")).not.toBeNull());
    const card = container.querySelector("[data-your-page-hidden]")!;
    expect(card.getAttribute("data-your-page-hidden")).toBe("email");
    expect(card.getAttribute("data-notice")).toBe("info");
    expect(card.textContent).toContain("until your email is confirmed");
    expect(screen.getByRole("link", { name: "Account and security" }).getAttribute("href")).toBe("/profile?tab=security");
  });

  it("any other reason: says it is under review and offers Ask us why", async () => {
    who.profile = { email_verified: true };
    const { container } = mountLink();
    await waitFor(() => expect(container.querySelector("[data-your-page-hidden]")).not.toBeNull());
    expect(container.querySelector("[data-your-page-hidden]")!.getAttribute("data-your-page-hidden")).toBe("other");
    expect(screen.getByRole("link", { name: "Ask us why" }).getAttribute("href")).toContain("/support");
  });
});
