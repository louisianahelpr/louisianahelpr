import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { ErrorState } from "./ErrorState";

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
});
