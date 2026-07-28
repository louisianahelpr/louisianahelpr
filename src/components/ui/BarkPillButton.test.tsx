import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { BarkPillButton } from "./BarkPillButton";

describe("BarkPillButton", () => {
  it("renders its children inside a button", () => {
    render(<BarkPillButton>Browse jobs</BarkPillButton>);
    expect(screen.getByRole("button", { name: "Browse jobs" })).toBeInTheDocument();
  });

  it("forwards onClick", () => {
    const onClick = vi.fn();
    render(<BarkPillButton onClick={onClick}>Go</BarkPillButton>);
    fireEvent.click(screen.getByRole("button", { name: "Go" }));
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it("keeps the pill base class and merges a caller-supplied className", () => {
    render(<BarkPillButton className="mt-4">Go</BarkPillButton>);
    const btn = screen.getByRole("button", { name: "Go" });
    expect(btn).toHaveClass("rounded-ds-md", "mt-4");
  });

  it("forwards the disabled prop and blocks clicks while disabled", () => {
    const onClick = vi.fn();
    render(
      <BarkPillButton disabled onClick={onClick}>
        Go
      </BarkPillButton>,
    );
    const btn = screen.getByRole("button", { name: "Go" });
    expect(btn).toBeDisabled();
    fireEvent.click(btn);
    expect(onClick).not.toHaveBeenCalled();
  });
});
