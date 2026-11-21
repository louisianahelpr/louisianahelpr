/**
 * Holiday audit C2 (High, 11-20): the Secret Santa organizer's drawn links lived only in page memory, so a reload lost
 * them, and the only way back (a new draw) made a second set of matches while the first links kept working.
 *   - the draw is kept on this device right after it is saved (lh-santa-last): a fresh page shows "Your last draw"
 *     with every person's Send and Copy again, and the same links;
 *   - Send or Copy marks that person Sent, and that is kept too;
 *   - leaving with a link not yet sent asks first (beforeunload), and stops asking once all are sent;
 *   - "Start a new group" warns, then turns the old draw off on the server with EVERY token (secret_santa_cancel)
 *     before the form comes back; if the server can't be reached the draw is kept and the organizer is told;
 *   - a kept draw past its expiry, or junk in storage, is dropped.
 * Server side (only the full token set deletes a group): src/test/pglite/giftGuideSecretSanta.pglite.mjs.
 *
 * @mutate src/pages/info/giftGuides/fun/SecretSanta.tsx |       saveSantaLast(draw);\n | \n
 * @mutate src/pages/info/giftGuides/fun/SecretSanta.tsx |       await cancelSecretSanta(done.code, done.tokens); |       void done;
 * @mutate src/pages/info/giftGuides/fun/SecretSanta.tsx |     if (!unsent) return; |     if (unsent >= 0) return;
 * @mutate src/pages/info/giftGuides/fun/santaLastDraw.ts |   if (Date.parse(d.expiresAt as string) <= now.getTime()) { |   if (false) {
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

vi.mock("@/components/marketing/PublicHeaderPage", () => ({
  PublicHeaderPage: ({ children }: { children: React.ReactNode }) => <main>{children}</main>,
}));
vi.mock("@/lib/analytics", () => ({ track: vi.fn() }));
vi.mock("@/lib/errorLogger", () => ({ report: vi.fn() }));
const copy = vi.fn();
vi.mock("@/lib/nativeShare", () => ({ copyToClipboard: (...a: unknown[]) => copy(...a), shareNative: vi.fn().mockResolvedValue("shared") }));
const create = vi.fn();
const cancel = vi.fn();
vi.mock("@/lib/giftGuideFunApi", () => ({
  createSecretSanta: (...a: unknown[]) => create(...a),
  cancelSecretSanta: (...a: unknown[]) => cancel(...a),
  SantaSaveError: class extends Error {},
}));
import SecretSanta from "@/pages/info/giftGuides/fun/SecretSanta";
import { SANTA_LAST_KEY, readSantaLast, santaExpiry } from "@/pages/info/giftGuides/fun/santaLastDraw";
import { resetHintsForTests } from "@/pages/info/giftGuides/GiftHint";

const CODE = "abcdef0123";
const TOKENS = ["a", "b", "c"].map((c) => c.repeat(64));

const drawThree = async () => {
  const view = render(<MemoryRouter><SecretSanta /></MemoryRouter>);
  const { container } = view;
  ["Ann", "Ben", "Cal"].forEach((n, i) => fireEvent.change(container.querySelector(`[data-santa-name="${i}"]`)!, { target: { value: n } }));
  fireEvent.click(container.querySelector("[data-santa-draw]")!);
  await waitFor(() => expect(container.querySelector("[data-santa-done]")).not.toBeNull());
  return view;
};

beforeEach(() => {
  localStorage.clear();
  resetHintsForTests?.();
  create.mockReset().mockResolvedValue({ code: CODE, tokens: TOKENS });
  cancel.mockReset().mockResolvedValue(true);
  copy.mockReset().mockResolvedValue(true);
});
afterEach(() => cleanup());

describe("Secret Santa: the organizer's draw survives a reload (holiday audit C2)", () => {
  it("keeps the draw on this device and shows it again on a fresh page, with the same links", async () => {
    const first = await drawThree();
    const kept = JSON.parse(localStorage.getItem(SANTA_LAST_KEY) ?? "null");
    expect(kept?.code).toBe(CODE);
    expect(kept?.tokens).toEqual(TOKENS);
    expect(kept?.names).toEqual(["Ann", "Ben", "Cal"]);
    first.unmount();

    const { container } = render(<MemoryRouter><SecretSanta /></MemoryRouter>);
    expect(container.querySelector("#santa-done")?.textContent).toMatch(/^Your last draw \(/);
    expect(container.querySelectorAll("[data-santa-person]").length).toBe(3);
    fireEvent.click(container.querySelector('[data-santa-copy="1"]')!);
    await waitFor(() => expect(copy).toHaveBeenCalled());
    expect(String(copy.mock.calls[0][0])).toContain(`/gift-guides/secret-santa/${CODE}/${TOKENS[1]}`);
  });

  it("Send or Copy marks that person Sent, and it is kept", async () => {
    const { container, unmount } = await drawThree();
    expect(container.querySelector('[data-santa-sent="0"]')).toBeNull();
    fireEvent.click(container.querySelector('[data-santa-send="0"]')!);
    fireEvent.click(container.querySelector('[data-santa-copy="2"]')!);
    await waitFor(() => expect(container.querySelector('[data-santa-sent="2"]')).not.toBeNull());
    expect(container.querySelector('[data-santa-sent="0"]')?.textContent).toContain("Sent");
    expect(container.querySelector('[data-santa-sent="1"]')).toBeNull();
    expect(readSantaLast()?.sent.sort()).toEqual([0, 2]);
    unmount();
    const again = render(<MemoryRouter><SecretSanta /></MemoryRouter>);
    expect(again.container.querySelector('[data-santa-sent="2"]')).not.toBeNull();
  });

  it("leaving with an unsent link asks first; once every link is sent it does not", async () => {
    const { container } = await drawThree();
    const leave = () => {
      const e = new Event("beforeunload", { cancelable: true });
      window.dispatchEvent(e);
      return e.defaultPrevented;
    };
    expect(leave()).toBe(true);
    for (const i of [0, 1, 2]) fireEvent.click(container.querySelector(`[data-santa-send="${i}"]`)!);
    await waitFor(() => expect(container.querySelectorAll("[data-santa-sent]").length).toBe(3));
    expect(leave()).toBe(false);
  });

  it("Start a new group warns, turns the old links off on the server with every token, then clears", async () => {
    const { container } = await drawThree();
    fireEvent.click(container.querySelector("[data-santa-again]")!);
    expect(container.querySelector("[data-santa-reset-confirm]")?.textContent).toMatch(/turns off every link/i);
    expect(cancel).not.toHaveBeenCalled();
    // "Keep this draw" changes nothing.
    fireEvent.click(container.querySelector("[data-santa-reset-no]")!);
    expect(container.querySelector("[data-santa-done]")).not.toBeNull();
    fireEvent.click(container.querySelector("[data-santa-again]")!);
    await act(async () => { fireEvent.click(container.querySelector("[data-santa-reset-yes]")!); });
    expect(cancel).toHaveBeenCalledWith(CODE, TOKENS);
    await waitFor(() => expect(container.querySelector("[data-santa-form]")).not.toBeNull());
    expect(localStorage.getItem(SANTA_LAST_KEY)).toBeNull();
  });

  it("if the old links could not be turned off, the draw is kept and the organizer is told", async () => {
    cancel.mockRejectedValue(new Error("offline"));
    const { container } = await drawThree();
    fireEvent.click(container.querySelector("[data-santa-again]")!);
    await act(async () => { fireEvent.click(container.querySelector("[data-santa-reset-yes]")!); });
    await waitFor(() => expect(container.querySelector("[data-santa-reset-error]")).not.toBeNull());
    expect(container.querySelector("[data-santa-done]")).not.toBeNull();
    expect(readSantaLast()?.code).toBe(CODE);
  });

  it("a kept draw past its expiry, or junk, is dropped", () => {
    const old = { code: CODE, names: ["Ann", "Ben", "Cal"], tokens: TOKENS, createdAt: "2025-11-20T00:00:00Z", expiresAt: "2026-01-16T06:00:00Z", sent: [] };
    localStorage.setItem(SANTA_LAST_KEY, JSON.stringify(old));
    expect(readSantaLast(new Date("2026-11-20T12:00:00Z"))).toBeNull();
    expect(localStorage.getItem(SANTA_LAST_KEY)).toBeNull();
    localStorage.setItem(SANTA_LAST_KEY, JSON.stringify({ ...old, expiresAt: "2027-01-16T06:00:00Z", tokens: ["nope"] }));
    expect(readSantaLast(new Date("2026-11-20T12:00:00Z"))).toBeNull();
    localStorage.setItem(SANTA_LAST_KEY, "{not json");
    expect(readSantaLast()).toBeNull();
  });

  it("expiry follows the server: the coming Jan 16, or the exchange day + 31, never past 90 days", () => {
    expect(santaExpiry(new Date("2026-11-20T18:00:00Z")).toISOString()).toBe("2027-01-16T06:00:00.000Z");
    expect(santaExpiry(new Date("2026-11-20T18:00:00Z"), "2027-01-10").toISOString()).toBe("2027-02-10T06:00:00.000Z");
    expect(santaExpiry(new Date("2026-12-20T18:00:00Z"), "2027-02-20").getTime()).toBe(new Date("2026-12-20T18:00:00Z").getTime() + 90 * 86400000);
  });
});
