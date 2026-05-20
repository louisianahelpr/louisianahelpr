import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { SampleJobTemplates } from "./SampleJobTemplates";
import { sampleJobs } from "@/data/sampleJobs";

const trackMock = vi.fn();
vi.mock("@/lib/analytics", () => ({
  track: (...args: unknown[]) => trackMock(...args),
}));

interface RenderOptions {
  title?: string;
  category?: string;
}

function renderTemplates(opts: RenderOptions = {}) {
  const setters = {
    setTitle: vi.fn(),
    setDescription: vi.fn(),
    setCategory: vi.fn(),
    setBudget: vi.fn(),
    setEstimatedHours: vi.fn(),
  };
  const result = render(
    <SampleJobTemplates
      title={opts.title ?? ""}
      category={opts.category ?? "other"}
      {...setters}
    />,
  );
  return { ...setters, ...result };
}

describe("SampleJobTemplates", () => {
  beforeEach(() => {
    trackMock.mockReset();
  });

  it("renders the template row when the form is empty", () => {
    renderTemplates();
    expect(screen.getByText(/Start from a template/i)).toBeInTheDocument();
    // Every sample should render a tappable button.
    for (const sample of sampleJobs) {
      expect(
        screen.getByRole("button", { name: new RegExp(`Use template: ${sample.title}`, "i") }),
      ).toBeInTheDocument();
    }
  });

  it("hides itself once the customer has typed a title", () => {
    renderTemplates({ title: "Mow my lawn" });
    expect(screen.queryByText(/Start from a template/i)).toBeNull();
  });

  it("hides itself once the customer has picked a non-default category", () => {
    renderTemplates({ category: "cleaning" });
    expect(screen.queryByText(/Start from a template/i)).toBeNull();
  });

  it("pre-fills every form field and fires analytics when a template is tapped", () => {
    const { setTitle, setDescription, setCategory, setBudget, setEstimatedHours } =
      renderTemplates();
    const sample = sampleJobs[0];

    fireEvent.click(
      screen.getByRole("button", { name: new RegExp(`Use template: ${sample.title}`, "i") }),
    );

    expect(setCategory).toHaveBeenCalledWith(sample.category);
    expect(setTitle).toHaveBeenCalledWith(sample.title);
    expect(setDescription).toHaveBeenCalledWith(sample.description);
    expect(setBudget).toHaveBeenCalledWith(String(sample.typical_price));
    // estimatedHours is hours not minutes — verify the conversion.
    expect(setEstimatedHours).toHaveBeenCalledWith(
      (sample.typical_duration_minutes / 60).toString(),
    );
    expect(trackMock).toHaveBeenCalledWith("sample_job_template_selected", {
      template_id: sample.id,
    });
  });

  it("dismisses after pre-filling so the row doesn't tempt mid-flow", () => {
    renderTemplates();
    const sample = sampleJobs[0];
    fireEvent.click(
      screen.getByRole("button", { name: new RegExp(`Use template: ${sample.title}`, "i") }),
    );
    expect(screen.queryByText(/Start from a template/i)).toBeNull();
  });

  it('dismisses when the customer taps "Or start from scratch"', () => {
    renderTemplates();
    fireEvent.click(screen.getByRole("button", { name: /Or start from scratch/i }));
    expect(screen.queryByText(/Start from a template/i)).toBeNull();
    expect(trackMock).toHaveBeenCalledWith("sample_job_template_dismissed", {});
  });
});
