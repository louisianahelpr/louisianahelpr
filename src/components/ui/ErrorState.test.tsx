import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { ErrorState } from "./ErrorState";
import { report } from "@/lib/errorLogger";

// Mocked so the telemetry below is OBSERVABLE, not so it is silenced: the
// real `report()` writes to the `error_logs` table, which every render in
// this file would otherwise attempt. The mock has no default return that
// could make a branch unreachable — the component ignores the result.
vi.mock("@/lib/errorLogger", () => ({ report: vi.fn() }));

const reportMock = vi.mocked(report);

beforeEach(() => {
  reportMock.mockClear();
});

describe("ErrorState", () => {
  it("renders the default error copy", () => {
    render(<ErrorState />);
    expect(screen.getByText("Hiccup on our end")).toBeInTheDocument();
    expect(screen.getByText("We couldn't load this.")).toBeInTheDocument();
  });

  it("renders custom eyebrow / title / body when supplied", () => {
    render(
      <ErrorState eyebrow="Feed offline" title="No jobs loaded" body="Tap to retry." />,
    );
    expect(screen.getByText("Feed offline")).toBeInTheDocument();
    expect(screen.getByText("No jobs loaded")).toBeInTheDocument();
    expect(screen.getByText("Tap to retry.")).toBeInTheDocument();
  });

  it("shows no retry button when onRetry is omitted", () => {
    render(<ErrorState />);
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });

  it("renders a retry button and calls onRetry when it is clicked", () => {
    const onRetry = vi.fn();
    render(<ErrorState onRetry={onRetry} />);
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it("honors a custom retry label", () => {
    render(<ErrorState onRetry={vi.fn()} retryLabel="Reload feed" />);
    expect(screen.getByRole("button", { name: "Reload feed" })).toBeInTheDocument();
  });

  it("disables retry while a retry is in flight, so a double-tap can't fire two fetches", () => {
    const onRetry = vi.fn();
    render(<ErrorState onRetry={onRetry} retryDisabled />);
    const btn = screen.getByRole("button", { name: "Try again" });
    expect(btn).toBeDisabled();
    fireEvent.click(btn);
    fireEvent.click(btn);
    expect(onRetry).not.toHaveBeenCalled();
  });

  it("renders a secondaryAction below retry so a stuck error isn't a dead end", () => {
    render(
      <ErrorState onRetry={vi.fn()} secondaryAction={<button>Browse helprs</button>} />,
    );
    expect(screen.getByRole("button", { name: "Try again" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Browse helprs" })).toBeInTheDocument();
  });

  it("renders the secondaryAction even with no retry handler", () => {
    render(<ErrorState secondaryAction={<button>Browse helprs</button>} />);
    expect(screen.getByRole("button", { name: "Browse helprs" })).toBeInTheDocument();
  });

  /*
   * THE TELEMETRY. Forty callers reach this card from props, manual state or
   * a hook in another file; none of those paths says "a person saw an error
   * screen". This effect is the only thing that does, and it is what the
   * prod-errors alert counts — so the whole of it was deletable with the five
   * tests above green.
   */
  describe("error-screen telemetry", () => {
    it("reports exactly once per mount, tagged with the title the person read", () => {
      render(<ErrorState title="No jobs loaded" />);
      expect(reportMock).toHaveBeenCalledTimes(1);
      const [err, opts] = reportMock.mock.calls[0];
      expect((err as Error).message).toBe("Error screen shown: No jobs loaded");
      expect(opts).toMatchObject({
        severity: "warning",
        tags: expect.objectContaining({ source: "ErrorState", title: "No jobs loaded" }),
      });
    });

    it("does NOT report while the device is offline — no connection is not a defect", () => {
      const spy = vi.spyOn(navigator, "onLine", "get").mockReturnValue(false);
      try {
        render(<ErrorState />);
        expect(reportMock).not.toHaveBeenCalled();
      } finally {
        spy.mockRestore();
      }
    });

    it("still reports when the device is online", () => {
      const spy = vi.spyOn(navigator, "onLine", "get").mockReturnValue(true);
      try {
        render(<ErrorState />);
        expect(reportMock).toHaveBeenCalledTimes(1);
      } finally {
        spy.mockRestore();
      }
    });
  });
});

// The only signal that a HUMAN saw an error screen. An over-broad offline
// guard silences it everywhere and the prod-errors alert counts zero.
// @mutate src/components/ui/ErrorState.tsx | if (typeof navigator !== "undefined" && navigator.onLine === false) return; | if (typeof navigator !== "undefined") return;
// The in-flight lock on retry: without it a double-tap fires two fetches.
// @mutate src/components/ui/ErrorState.tsx | <BarkPillButton onClick={onRetry} disabled={retryDisabled}> | <BarkPillButton onClick={onRetry}>
