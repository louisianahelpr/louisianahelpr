// Render-no-throw smoke tests for the card-matching skeleton variants.
// These cards back high-traffic loading states (Dashboard / Activity /
// Messages); a regression that throws on render would blank the whole
// surface during the load, so a tiny "does it mount" check is enough.
import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";

import { JobCardSkeleton } from "./JobCardSkeleton";
import { ApplicationCardSkeleton } from "./ApplicationCardSkeleton";
import { MessageThreadSkeleton } from "./MessageThreadSkeleton";

describe("card-matching skeletons", () => {
  it("JobCardSkeleton mounts without throwing", () => {
    const { container } = render(<JobCardSkeleton />);
    // One root card div + skeleton block children.
    expect(container.firstChild).toBeInTheDocument();
  });

  it("ApplicationCardSkeleton mounts without throwing", () => {
    const { container } = render(<ApplicationCardSkeleton />);
    expect(container.firstChild).toBeInTheDocument();
  });

  it("MessageThreadSkeleton mounts without throwing", () => {
    const { container } = render(<MessageThreadSkeleton />);
    expect(container.firstChild).toBeInTheDocument();
  });
});
