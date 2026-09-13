// RichMessageInput — a same-frame double tap on Send must post ONE message.
// Two clicks dispatched before React re-renders both read the same `text`
// closure, so only a synchronous ref can stop the second onSend.
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

vi.mock("@/lib/haptics", () => ({ hapticLight: vi.fn(), hapticError: vi.fn(), hapticMedium: vi.fn(), hapticSuccess: vi.fn() }));
vi.mock("sonner", () => ({ toast: Object.assign(vi.fn(), { error: vi.fn(), success: vi.fn() }) }));

import { RichMessageInput } from "./RichMessageInput";

describe("RichMessageInput same-frame double send", () => {
  it("calls onSend once for two clicks in one frame", async () => {
    const onSend = vi.fn();
    render(
      <QueryClientProvider client={new QueryClient()}>
        <MemoryRouter>
          {/* Controlled, and the parent has not re-rendered yet: value stays put. */}
          <RichMessageInput onSend={onSend} value="hello there" onChange={() => {}} jobId="j1" senderId="u1" />
        </MemoryRouter>
      </QueryClientProvider>,
    );
    const send = screen.getByRole("button", { name: "Send message" });
    await act(async () => {
      fireEvent.click(send);
      fireEvent.click(send);
    });
    expect(onSend).toHaveBeenCalledTimes(1);
  });
});
