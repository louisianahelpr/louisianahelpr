import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { Inbox } from "lucide-react";
import { EmptyState } from "./EmptyState";

describe("EmptyState", () => {
  it("renders the eyebrow, title, and body copy", () => {
    render(
      <EmptyState
        icon={Inbox}
        eyebrow="No messages"
        title="Inbox zero"
        body="You're all caught up."
      />,
    );
    expect(screen.getByText("No messages")).toBeInTheDocument();
    expect(screen.getByText("Inbox zero")).toBeInTheDocument();
    expect(screen.getByText("You're all caught up.")).toBeInTheDocument();
  });

  it("renders the supplied icon", () => {
    const { container } = render(
      <EmptyState icon={Inbox} eyebrow="e" title="t" body="b" />,
    );
    expect(container.querySelector("svg")).toBeInTheDocument();
  });

  it("renders the optional action node when provided", () => {
    render(
      <EmptyState
        icon={Inbox}
        eyebrow="e"
        title="t"
        body="b"
        action={<button>Browse jobs</button>}
      />,
    );
    expect(screen.getByRole("button", { name: "Browse jobs" })).toBeInTheDocument();
  });

  it("renders no action element when none is supplied", () => {
    render(<EmptyState icon={Inbox} eyebrow="e" title="t" body="b" />);
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });
});
