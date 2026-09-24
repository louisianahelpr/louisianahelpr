// RichMessageInput — a same-frame double tap on Send must post ONE message.
// Two clicks dispatched before React re-renders both read the same `text`
// closure, so only a synchronous ref can stop the second onSend.
//
// HALF THIS FILE IS ABOUT THE RELEASE, and it did not used to be. A test that
// only proves the SECOND tap is refused passes with every release of
// `sendingRef` deleted — and a latch that engages and never releases is not a
// double-send guard, it is a permanent mute on the conversation after one
// message. That exact defect shipped in PostedJobActions. There are three
// releases here and they cover different worlds:
//   * the effect, `if (!text && !stagedFile)` — the normal path, where the
//     parent clears the draft after a successful send;
//   * the 1500ms backstop — the failure path, where the parent RESTORES the
//     draft so the user can retry, so the text never goes empty and the
//     effect never fires;
//   * the settled promise — an async parent (ChatComposer) that refused the
//     send at once, where waiting out the backstop ate the user's retry (Q268).
// Delete any one and a real user is stuck; the tests below break on each.
import { useState } from "react";
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

vi.mock("@/lib/haptics", () => ({ hapticLight: vi.fn(), hapticError: vi.fn(), hapticMedium: vi.fn(), hapticSuccess: vi.fn() }));
vi.mock("sonner", () => ({ toast: Object.assign(vi.fn(), { error: vi.fn(), success: vi.fn() }) }));

import { RichMessageInput } from "./RichMessageInput";

const wrap = (children: React.ReactNode) => (
  <QueryClientProvider client={new QueryClient()}>
    <MemoryRouter>{children}</MemoryRouter>
  </QueryClientProvider>
);

/** A parent that clears the draft once the send lands — the happy path. */
function Conversation({ onSend }: { onSend: (text: string) => void }) {
  const [value, setValue] = useState("first message");
  return (
    <RichMessageInput onSend={onSend} value={value} onChange={setValue} jobId="j1" senderId="u1" />
  );
}

describe("RichMessageInput same-frame double send", () => {
  it("calls onSend once for two clicks in one frame", async () => {
    const onSend = vi.fn();
    render(
      wrap(
        /* Controlled, and the parent has not re-rendered yet: value stays put. */
        <RichMessageInput onSend={onSend} value="hello there" onChange={() => {}} jobId="j1" senderId="u1" />,
      ),
    );
    const send = screen.getByRole("button", { name: "Send message" });
    await act(async () => {
      fireEvent.click(send);
      fireEvent.click(send);
    });
    expect(onSend).toHaveBeenCalledTimes(1);
  });

  it("RELEASES on the cleared draft, so the next message sends", async () => {
    const onSend = vi.fn();
    render(wrap(<Conversation onSend={onSend} />));
    const send = screen.getByRole("button", { name: "Send message" });

    await act(async () => { fireEvent.click(send); });
    expect(onSend).toHaveBeenCalledWith("first message");

    // The parent cleared the box, the effect released the latch, and the user
    // types their second message. Without that release this conversation is
    // one message long, permanently.
    const box = screen.getByRole("textbox", { name: "Type a message" });
    await act(async () => { fireEvent.change(box, { target: { value: "second message" } }); });
    await act(async () => { fireEvent.click(send); });
    expect(onSend).toHaveBeenCalledTimes(2);
    expect(onSend).toHaveBeenLastCalledWith("second message");
  });

  it("RELEASES via the backstop when the parent keeps the draft after a failure", async () => {
    vi.useFakeTimers();
    try {
      const onSend = vi.fn();
      render(
        // The send failed and the parent put the text back, so `text` is never
        // empty and the clear-on-empty effect never runs. The 1500ms backstop
        // is the ONLY thing standing between this user and a dead Send button.
        wrap(<RichMessageInput onSend={onSend} value="hello there" onChange={() => {}} jobId="j1" senderId="u1" />),
      );
      const send = screen.getByRole("button", { name: "Send message" });

      await act(async () => { fireEvent.click(send); });
      expect(onSend).toHaveBeenCalledTimes(1);

      // Still latched a moment later — the double-tap guard is doing its job.
      await act(async () => { vi.advanceTimersByTime(200); });
      await act(async () => { fireEvent.click(send); });
      expect(onSend).toHaveBeenCalledTimes(1);

      // …and released once the backstop fires, so the retry goes through.
      await act(async () => { vi.advanceTimersByTime(1500); });
      await act(async () => { fireEvent.click(send); });
      expect(onSend).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it("RELEASES when an async parent refuses the send, so an immediate retry goes through (Q268)", async () => {
    vi.useFakeTimers();
    try {
      // ChatComposer's shape: onSend resolves once the send is decided. Refused
      // at once (offline), it restores the draft, so neither the cleared-draft
      // effect nor the 1500ms backstop has released the latch yet. Measured
      // live: a retry 150ms after an offline refusal was silently eaten.
      const onSend = vi.fn(async () => {});
      render(wrap(<RichMessageInput onSend={onSend} value="hello there" onChange={() => {}} jobId="j1" senderId="u1" />));
      const send = screen.getByRole("button", { name: "Send message" });

      await act(async () => { fireEvent.click(send); });
      expect(onSend).toHaveBeenCalledTimes(1);

      await act(async () => { vi.advanceTimersByTime(150); });
      await act(async () => { fireEvent.click(send); });
      expect(onSend).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });
});

// Release #3 — an async parent's verdict. Deleted, a refused send mutes the retry for 1.5s.
// @mutate src/components/RichMessageInput.tsx | if (settled) void settled.finally(() => { sendingRef.current = false; }); | void settled;

// Engage: the ref is the only thing that can see the second tap, because both
// taps read the same `text` closure before React re-renders.
// @mutate src/components/RichMessageInput.tsx | if (sendingRef.current) return; | if (false) return;
// Release #1 — the happy path. Deleted, the conversation ends after one message.
// @mutate src/components/RichMessageInput.tsx | if (!text && !stagedFile) sendingRef.current = false; | if (false) sendingRef.current = false;
// Release #2 — the failure path. Deleted, a single failed send mutes the user.
// @mutate src/components/RichMessageInput.tsx | setTimeout(() => { sendingRef.current = false; }, 1500); | void 0;
