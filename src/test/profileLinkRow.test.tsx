/**
 * LEAD-PROFILE-LINK (owner 2026-10-31): Settings › "Your profile link".
 *  - opening Settings never writes: the handle RPC runs only when the row is opened;
 *  - opened, it shows louisianahelpr.com/u/<handle> and the "Share my profile" button, which shares
 *    https://www.louisianahelpr.com/u/<handle>;
 *  - "Change link (once)" calls rpc_set_my_handle and then goes away; a refusal shows its words.
 *
 * @mutate src/components/profile/ProfileLinkRow.tsx | if (next && !handle && !loading) void load(); | void load();
 * @mutate src/components/profile/ProfileLinkRow.tsx | {!changed && ( | {( 
 * @mutate src/lib/profileLink/api.ts | return `${SITE_ORIGIN}/u/${encodeURIComponent(handle)}`; | return SITE_ORIGIN;
 * @mutate src/lib/profileLink/api.ts | return { error: rpcErrorMessage("rpc_set_my_handle", error) ?? "We couldn't save that link. Try again." }; | return { error: "We couldn't save that link. Try again." };
 */
import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

const rpc = vi.fn();
const share = vi.fn(async () => "shared");
vi.mock("@/integrations/supabase/client", () => ({ supabase: { rpc: (...a: unknown[]) => rpc(...a) } }));
vi.mock("@/lib/nativeShare", () => ({ shareNative: (c: unknown) => share(c) }));

import { ProfileLinkRow } from "@/components/profile/ProfileLinkRow";

beforeEach(() => {
  rpc.mockReset();
  share.mockClear();
});

describe("Settings › Your profile link", () => {
  it("does not call the server until the row is opened", () => {
    render(<ProfileLinkRow name="Eli" />);
    expect(screen.getByText("Your profile link")).toBeTruthy();
    expect(rpc).not.toHaveBeenCalled();
  });

  it("opened, it shows the link and shares the full URL", async () => {
    rpc.mockResolvedValueOnce({ data: "eli-b", error: null });
    render(<ProfileLinkRow name="Eli" />);
    fireEvent.click(screen.getByRole("button", { name: /your profile link/i }));
    await waitFor(() => expect(screen.getByText("louisianahelpr.com/u/eli-b")).toBeTruthy());
    expect(rpc).toHaveBeenCalledWith("rpc_ensure_my_handle");
    fireEvent.click(screen.getByRole("button", { name: /share my profile/i }));
    await waitFor(() => expect(share).toHaveBeenCalledTimes(1));
    expect(share.mock.calls[0][0]).toMatchObject({ url: "https://www.louisianahelpr.com/u/eli-b" });
  });

  it("changes the link once, then offers no second change", async () => {
    rpc.mockResolvedValueOnce({ data: "eli-b", error: null }).mockResolvedValueOnce({ data: "eli-fixes", error: null });
    render(<ProfileLinkRow name="Eli" />);
    fireEvent.click(screen.getByRole("button", { name: /your profile link/i }));
    fireEvent.click(await screen.findByRole("button", { name: /change link \(once\)/i }));
    fireEvent.change(screen.getByLabelText("New link"), { target: { value: "Eli-Fixes" } });
    fireEvent.click(screen.getByRole("button", { name: /save link/i }));
    await waitFor(() => expect(screen.getByText("louisianahelpr.com/u/eli-fixes")).toBeTruthy());
    expect(rpc).toHaveBeenLastCalledWith("rpc_set_my_handle", { p_handle: "eli-fixes" });
    expect(screen.queryByRole("button", { name: /change link/i })).toBeNull();
  });

  it("a member who already changed it sees no Change button", async () => {
    rpc.mockResolvedValueOnce({ data: "eli-fixes", error: null });
    render(<ProfileLinkRow name="Eli" changedOnce />);
    fireEvent.click(screen.getByRole("button", { name: /your profile link/i }));
    await screen.findByRole("button", { name: /share my profile/i });
    expect(screen.queryByRole("button", { name: /change link/i })).toBeNull();
  });

  it("a refused change shows the server's words", async () => {
    rpc
      .mockResolvedValueOnce({ data: "eli-b", error: null })
      .mockResolvedValueOnce({ data: null, error: { message: "handle_taken", code: "P0001" } });
    render(<ProfileLinkRow name="Eli" />);
    fireEvent.click(screen.getByRole("button", { name: /your profile link/i }));
    fireEvent.click(await screen.findByRole("button", { name: /change link \(once\)/i }));
    fireEvent.change(screen.getByLabelText("New link"), { target: { value: "taken-one" } });
    fireEvent.click(screen.getByRole("button", { name: /save link/i }));
    expect((await screen.findByRole("alert")).textContent).toBe("Someone already has that link. Try another.");
  });
});
