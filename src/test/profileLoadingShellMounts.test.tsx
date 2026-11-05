/**
 * #3491 follow-up: Profile CALLS ProfileLoadingShell (profileShellKeepsItsAppShell.test.ts), so no JSX tag mounts it
 * and vacuity's mount scan cannot see Profile -> shell. This renders the shell itself and asserts what it mounts:
 * the landing skeleton inside the offline gate, under the busy frame.
 *
 * @mutate src/pages/profile/ProfileLoadingShell.tsx |             <ProfilePageSkeleton />\n | {null}\n
 */
import { vi, describe, it, expect, afterEach } from "vitest";
import { render, cleanup } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ProfileLoadingShell } from "@/pages/profile/ProfileLoadingShell";
vi.mock("@/components/help/HelpEntry", () => ({ HelpEntry: () => null })); // Its top bar's Help needs the app's providers.

afterEach(cleanup);

describe("ProfileLoadingShell mounts the landing skeleton in its busy frame", () => {
  it("landing: the busy frame holds ProfilePageSkeleton", () => {
    const { container } = render(
      <QueryClientProvider client={new QueryClient()}>
        <MemoryRouter initialEntries={["/profile"]}>
          <ProfileLoadingShell tab="landing" backFromTab={() => {}} />
        </MemoryRouter>
      </QueryClientProvider>,
    );
    const busy = container.querySelector('[aria-busy="true"]');
    expect(busy).not.toBeNull();
    expect(busy!.querySelector('[data-testid="profile-landing-skeleton"]')).not.toBeNull();
  });
});
